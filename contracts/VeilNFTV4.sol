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

    event NftEscrowed(uint256 indexed auctionId, address indexed tokenContract, uint256 indexed tokenId, uint8 standard, uint256 amount, address seller);
    event NftDelivered(uint256 indexed auctionId, address indexed winner, address indexed tokenContract, uint256 tokenId, uint256 amount);
    event NftReturned(uint256 indexed auctionId, address indexed seller, address indexed tokenContract, uint256 tokenId, uint256 amount);

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

    function _deliverNft(uint256 auctionId, address winner) internal {
        NftAsset storage asset = nftAssets[auctionId];
        require(asset.escrowed && !asset.delivered, "NFT is not available in escrow");
        asset.escrowed = false;
        asset.delivered = true;

        if (asset.standard == TokenStandard.ERC721) {
            require(IERC721Veil(asset.tokenContract).ownerOf(asset.tokenId) == address(this), "Escrow lost ERC721");
            IERC721Veil(asset.tokenContract).safeTransferFrom(address(this), winner, asset.tokenId);
            require(IERC721Veil(asset.tokenContract).ownerOf(asset.tokenId) == winner, "Winner did not receive ERC721");
        } else {
            uint256 beforeBalance = IERC1155Veil(asset.tokenContract).balanceOf(winner, asset.tokenId);
            require(IERC1155Veil(asset.tokenContract).balanceOf(address(this), asset.tokenId) >= asset.amount, "Escrow lost ERC1155");
            IERC1155Veil(asset.tokenContract).safeTransferFrom(address(this), winner, asset.tokenId, asset.amount, "");
            require(IERC1155Veil(asset.tokenContract).balanceOf(winner, asset.tokenId) >= beforeBalance + asset.amount, "Winner did not receive ERC1155");
        }
        emit NftDelivered(auctionId, winner, asset.tokenContract, asset.tokenId, asset.amount);
    }

    function _returnNft(uint256 auctionId) internal {
        NftAsset storage asset = nftAssets[auctionId];
        require(asset.escrowed && !asset.delivered, "NFT is not available in escrow");
        address seller = auctions[auctionId].seller;
        asset.escrowed = false;

        if (asset.standard == TokenStandard.ERC721) {
            require(IERC721Veil(asset.tokenContract).ownerOf(asset.tokenId) == address(this), "Escrow lost ERC721");
            IERC721Veil(asset.tokenContract).safeTransferFrom(address(this), seller, asset.tokenId);
            require(IERC721Veil(asset.tokenContract).ownerOf(asset.tokenId) == seller, "Seller did not receive ERC721");
        } else {
            uint256 beforeBalance = IERC1155Veil(asset.tokenContract).balanceOf(seller, asset.tokenId);
            require(IERC1155Veil(asset.tokenContract).balanceOf(address(this), asset.tokenId) >= asset.amount, "Escrow lost ERC1155");
            IERC1155Veil(asset.tokenContract).safeTransferFrom(address(this), seller, asset.tokenId, asset.amount, "");
            require(IERC1155Veil(asset.tokenContract).balanceOf(seller, asset.tokenId) >= beforeBalance + asset.amount, "Seller did not receive ERC1155");
        }
        emit NftReturned(auctionId, seller, asset.tokenContract, asset.tokenId, asset.amount);
    }
}
