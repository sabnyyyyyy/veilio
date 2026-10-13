// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VeilV3.sol";

interface IERC721Veil {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC1155Veil {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

/**
 * @title Veil NFT V4
 * @notice VeilV3 auctions with ERC-721/ERC-1155 custody and verified delivery.
 * @dev NFT listings require seller approval and transfer into this contract atomically with listing.
 *      NFT release and payment settlement happen in the same transaction after inspection expires.
 *      NFT releases are non-blocking: if the automatic transfer to the winner/seller fails, the
 *      settlement still completes and the recipient can pull the NFT later with `claimNft`.
 */
contract VeilNFTV4 is VeilV3 {
    enum TokenStandard { None, ERC721, ERC1155 }

    struct NftAsset {
        TokenStandard standard;
        address tokenContract;
        uint256 tokenId;
        uint256 amount;
        bool escrowed;
        bool delivered;
    }

    mapping(uint256 => NftAsset) public nftAssets;
    uint256 private _expectedAuctionId;

    /// @notice Gas forwarded to an automatic NFT release; a receiver needing more falls back to claimNft.
    uint256 public constant NFT_TRANSFER_GAS = 400_000;
    uint256 private constant NFT_QUERY_GAS = 50_000;

    /// @notice Address allowed to pull an NFT whose automatic release failed (winner or seller).
    mapping(uint256 => address) public nftClaimant;

    event NftEscrowed(uint256 indexed auctionId, address indexed tokenContract, uint256 indexed tokenId, uint8 standard, uint256 amount, address seller);
    event NftDelivered(uint256 indexed auctionId, address indexed winner, address indexed tokenContract, uint256 tokenId, uint256 amount);
    event NftReturned(uint256 indexed auctionId, address indexed seller, address indexed tokenContract, uint256 tokenId, uint256 amount);
    event NftTransferFailed(uint256 indexed auctionId, address indexed intendedRecipient);
    event NftClaimed(uint256 indexed auctionId, address indexed claimant, address indexed to);

    constructor(address _reviewer, address _feeRecipient) VeilV3(_reviewer, _feeRecipient) {}

    function createNftAuction(
        string memory itemName,
        string memory description,
        string memory imageURI,
        uint256 startingPrice,
        uint256 commitDuration,
        uint256 revealDuration,
        uint256 inspectionDuration,
        uint8 standard,
        address tokenContract,
        uint256 tokenId,
        uint256 amount
    ) external nonReentrant returns (uint256 auctionId) {
        require(standard == uint8(TokenStandard.ERC721) || standard == uint8(TokenStandard.ERC1155), "Unsupported token standard");
        require(tokenContract != address(0) && tokenContract.code.length > 0, "Invalid NFT contract");
        require(amount > 0, "NFT amount must be positive");
        if (standard == uint8(TokenStandard.ERC721)) require(amount == 1, "ERC721 amount must be one");

        auctionId = _createAuction(itemName, description, imageURI, startingPrice, commitDuration, revealDuration, inspectionDuration);
        nftAssets[auctionId] = NftAsset({
            standard: TokenStandard(standard),
            tokenContract: tokenContract,
            tokenId: tokenId,
            amount: amount,
            escrowed: false,
            delivered: false
        });
        _expectedAuctionId = auctionId;

        if (standard == uint8(TokenStandard.ERC721)) {
            IERC721Veil(tokenContract).safeTransferFrom(msg.sender, address(this), tokenId);
            require(IERC721Veil(tokenContract).ownerOf(tokenId) == address(this), "NFT did not enter escrow");
        } else {
            IERC1155Veil(tokenContract).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
            require(IERC1155Veil(tokenContract).balanceOf(address(this), tokenId) >= amount, "NFT did not enter escrow");
        }

        _expectedAuctionId = 0;
        nftAssets[auctionId].escrowed = true;
        emit NftEscrowed(auctionId, tokenContract, tokenId, standard, amount, msg.sender);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        NftAsset storage asset = nftAssets[_expectedAuctionId];
        require(_expectedAuctionId != 0 && asset.standard == TokenStandard.ERC721, "Unexpected NFT");
        require(msg.sender == asset.tokenContract && from == auctions[_expectedAuctionId].seller, "Wrong NFT sender");
        require(tokenId == asset.tokenId && operator == address(this), "Wrong NFT transfer");
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address operator, address from, uint256 tokenId, uint256 amount, bytes calldata) external view returns (bytes4) {
        NftAsset storage asset = nftAssets[_expectedAuctionId];
        require(_expectedAuctionId != 0 && asset.standard == TokenStandard.ERC1155, "Unexpected NFT");
        require(msg.sender == asset.tokenContract && from == auctions[_expectedAuctionId].seller, "Wrong NFT sender");
        require(tokenId == asset.tokenId && amount == asset.amount && operator == address(this), "Wrong NFT transfer");
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        revert("Batch transfer unsupported");
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x150b7a02 || interfaceId == 0x4e2312e0;
    }

    function acceptDataset(uint256 auctionId) public override {
        require(nftAssets[auctionId].standard == TokenStandard.None, "NFT delivery is automatic after inspection");
        super.acceptDataset(auctionId);
    }

    function _beforeSuccessfulSettlement(uint256 auctionId) internal override {
        NftAsset storage asset = nftAssets[auctionId];
        if (asset.standard != TokenStandard.None) _deliverNft(auctionId, auctions[auctionId].highestBidder);
    }

    function _onRefundApproved(uint256 auctionId) internal override {
        NftAsset storage asset = nftAssets[auctionId];
        if (asset.standard != TokenStandard.None) _returnNft(auctionId);
    }

    function _onNoWinner(uint256 auctionId) internal override {
        NftAsset storage asset = nftAssets[auctionId];
        if (asset.standard != TokenStandard.None) _returnNft(auctionId);
    }

    function _onCancel(uint256 auctionId) internal override {
        NftAsset storage asset = nftAssets[auctionId];
        if (asset.standard != TokenStandard.None) _returnNft(auctionId);
    }

    /**
     * @notice Recipient of a failed NFT release (winner or seller) pulls the NFT, optionally to
     *         another address (e.g. when their own contract wallet cannot receive it).
     */
    function claimNft(uint256 auctionId, address to) external nonReentrant {
        NftAsset storage asset = nftAssets[auctionId];
        address claimant = nftClaimant[auctionId];
        require(claimant != address(0) && msg.sender == claimant, "No NFT claimable");
        require(to != address(0), "Invalid recipient");
        require(asset.escrowed, "NFT is not available in escrow");

        nftClaimant[auctionId] = address(0);
        asset.escrowed = false;
        bool toWinner = claimant == auctions[auctionId].highestBidder;
        if (toWinner) asset.delivered = true;

        // Full-gas, reverting transfer: the claimant chose `to`, so a failure here only affects them.
        if (asset.standard == TokenStandard.ERC721) {
            IERC721Veil(asset.tokenContract).safeTransferFrom(address(this), to, asset.tokenId);
            require(IERC721Veil(asset.tokenContract).ownerOf(asset.tokenId) == to, "Recipient did not receive ERC721");
        } else {
            uint256 beforeBalance = IERC1155Veil(asset.tokenContract).balanceOf(to, asset.tokenId);
            IERC1155Veil(asset.tokenContract).safeTransferFrom(address(this), to, asset.tokenId, asset.amount, "");
            require(IERC1155Veil(asset.tokenContract).balanceOf(to, asset.tokenId) >= beforeBalance + asset.amount, "Recipient did not receive ERC1155");
        }

        emit NftClaimed(auctionId, msg.sender, to);
        if (toWinner) {
            emit NftDelivered(auctionId, to, asset.tokenContract, asset.tokenId, asset.amount);
        } else {
            emit NftReturned(auctionId, to, asset.tokenContract, asset.tokenId, asset.amount);
        }
    }

    function _deliverNft(uint256 auctionId, address winner) internal {
        NftAsset storage asset = nftAssets[auctionId];
        require(asset.escrowed && !asset.delivered, "NFT is not available in escrow");

        if (_tryTransferNft(asset, winner)) {
            asset.escrowed = false;
            asset.delivered = true;
            emit NftDelivered(auctionId, winner, asset.tokenContract, asset.tokenId, asset.amount);
        } else {
            // Keep custody; the winner can pull it via claimNft. Payment settlement proceeds.
            nftClaimant[auctionId] = winner;
            emit NftTransferFailed(auctionId, winner);
        }
    }

    function _returnNft(uint256 auctionId) internal {
        NftAsset storage asset = nftAssets[auctionId];
        require(asset.escrowed && !asset.delivered, "NFT is not available in escrow");
        address seller = auctions[auctionId].seller;

        if (_tryTransferNft(asset, seller)) {
            asset.escrowed = false;
            emit NftReturned(auctionId, seller, asset.tokenContract, asset.tokenId, asset.amount);
        } else {
            // Keep custody; the seller can pull it via claimNft. Bidder refunds proceed.
            nftClaimant[auctionId] = seller;
            emit NftTransferFailed(auctionId, seller);
        }
    }

    /**
     * @dev Non-reverting, gas-capped NFT release. Any failure (receiver rejects, token reverts,
     *      gas griefing, transfer not reflected in ownerOf/balanceOf) returns false instead of
     *      reverting, so a hostile seller/winner/token cannot block settlement of bidder deposits.
     */
    function _tryTransferNft(NftAsset storage asset, address to) internal returns (bool) {
        address token = asset.tokenContract;
        uint256 tokenId = asset.tokenId;
        if (asset.standard == TokenStandard.ERC721) {
            try IERC721Veil(token).safeTransferFrom{gas: NFT_TRANSFER_GAS}(address(this), to, tokenId) {
            } catch {
                return false;
            }
            try IERC721Veil(token).ownerOf{gas: NFT_QUERY_GAS}(tokenId) returns (address newOwner) {
                return newOwner == to;
            } catch {
                return false;
            }
        } else {
            uint256 amount = asset.amount;
            uint256 beforeBalance;
            try IERC1155Veil(token).balanceOf{gas: NFT_QUERY_GAS}(to, tokenId) returns (uint256 bal) {
                beforeBalance = bal;
            } catch {
                return false;
            }
            try IERC1155Veil(token).safeTransferFrom{gas: NFT_TRANSFER_GAS}(address(this), to, tokenId, amount, "") {
            } catch {
                return false;
            }
            try IERC1155Veil(token).balanceOf{gas: NFT_QUERY_GAS}(to, tokenId) returns (uint256 afterBalance) {
                return afterBalance >= beforeBalance + amount;
            } catch {
                return false;
            }
        }
    }
}
