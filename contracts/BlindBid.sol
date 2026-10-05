// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlindBid Protocol Infrastructure V2
 * @notice Trustless Sealed Maximum-Price Auction Marketplace.
 * @dev Enforces state machine transitions, sealed keccak256 maximum bids, Vickrey second-price pricing,
 * non-reveal anti-abort penalties, pull-based refunds, and reentrancy protection.
 */
contract BlindBid {
    enum AuctionState { Created, Bidding, Revealing, Settled, Cancelled }

    struct Auction {
        uint256 id;
        address payable seller;
        string itemName;
        string description;
        string imageURI; // Supports metadata URI (ipfs://...) or direct image URI
        uint256 startingPrice; // Reserve price
        uint256 commitEndTime;
        uint256 revealEndTime;
        AuctionState state;
        address highestBidder;
        uint256 highestBid;
        uint256 secondHighestBid;
        uint256 bidderCount;
        uint256 revealedCount;
        bytes32 finalTxHash;
    }

    struct BidCommitment {
        bytes32 commitment;
        uint256 deposit;
        bool revealed;
        uint256 maxBid;
    }

    uint256 public auctionCount;
    mapping(uint256 => Auction) public auctions;
    // auctionId => bidder address => BidCommitment
    mapping(uint256 => mapping(address => BidCommitment)) public commitments;
    // auctionId => list of bidders who committed
    mapping(uint256 => address[]) public auctionBidders;
    // bidder address => claimable balance
    mapping(address => uint256) public pendingRefunds;

    // Reentrancy Guard Lock
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        string itemName,
        uint256 startingPrice,
        uint256 commitEndTime,
        uint256 revealEndTime
    );

    event BidCommitted(
        uint256 indexed auctionId,
        address indexed bidder,
        bytes32 commitment,
        uint256 deposit
    );

    event BidRevealed(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 maxBid,
        bool isCurrentHighest
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 winningPrice,
        uint256 secondHighestBid
    );

    event RefundAvailable(address indexed account, uint256 amount);
    event RefundClaimed(address indexed account, uint256 amount);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor() {
        _status = _NOT_ENTERED;
    }

    /**
     * @notice Returns current dynamic state of an auction.
     */
    function getAuctionState(uint256 auctionId) public view returns (AuctionState) {
        Auction memory auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");

        if (auction.state == AuctionState.Settled || auction.state == AuctionState.Cancelled) {
            return auction.state;
        }

        if (block.timestamp < auction.commitEndTime) {
            return AuctionState.Bidding;
        } else if (block.timestamp < auction.revealEndTime) {
            return AuctionState.Revealing;
        } else {
            return AuctionState.Revealing; // Ready to be settled
        }
    }

    /**
     * @notice Create a new trustless sealed maximum-price auction.
     */
    function createAuction(
        string memory itemName,
        string memory description,
        string memory imageURI,
        uint256 startingPrice,
        uint256 commitDuration,
        uint256 revealDuration
    ) external returns (uint256 auctionId) {
        require(commitDuration >= 60, "Commit duration too short");
        require(revealDuration >= 60, "Reveal duration too short");

        auctionCount++;
        auctionId = auctionCount;

        auctions[auctionId] = Auction({
            id: auctionId,
            seller: payable(msg.sender),
            itemName: itemName,
            description: description,
            imageURI: imageURI,
            startingPrice: startingPrice,
            commitEndTime: block.timestamp + commitDuration,
            revealEndTime: block.timestamp + commitDuration + revealDuration,
            state: AuctionState.Created,
            highestBidder: address(0),
            highestBid: 0,
            secondHighestBid: 0,
            bidderCount: 0,
            revealedCount: 0,
            finalTxHash: bytes32(0)
        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            itemName,
            startingPrice,
            auctions[auctionId].commitEndTime,
            auctions[auctionId].revealEndTime
        );
    }

    /**
     * @notice Commit a hashed maximum bid during bidding phase.
     * @param auctionId Target auction ID.
     * @param commitment Hash of keccak256(abi.encodePacked(auctionId, msg.sender, maxBid, secret)).
     */
    function commitBid(uint256 auctionId, bytes32 commitment) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");
        require(block.timestamp < auction.commitEndTime, "Bidding phase has ended");
        require(msg.sender != auction.seller, "Seller cannot bid on own auction");
        require(msg.value >= auction.startingPrice, "Deposit below reserve/starting price");
        require(commitment != bytes32(0), "Invalid commitment");
        require(commitments[auctionId][msg.sender].commitment == bytes32(0), "Already committed");

        commitments[auctionId][msg.sender] = BidCommitment({
            commitment: commitment,
            deposit: msg.value,
            revealed: false,
            maxBid: 0
        });

        auctionBidders[auctionId].push(msg.sender);
        auction.bidderCount++;

        emit BidCommitted(auctionId, msg.sender, commitment, msg.value);
    }

    /**
     * @notice Reveal bid during reveal phase.
     */
    function revealBid(
        uint256 auctionId,
        uint256 maxBid,
        bytes32 secret
    ) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");
        require(block.timestamp >= auction.commitEndTime, "Commit phase still active");
        require(block.timestamp < auction.revealEndTime, "Reveal phase has ended");

        BidCommitment storage bidCommit = commitments[auctionId][msg.sender];
        require(bidCommit.commitment != bytes32(0), "No commitment found");
        require(!bidCommit.revealed, "Bid already revealed");

        bytes32 computedHash = keccak256(abi.encodePacked(auctionId, msg.sender, maxBid, secret));
        require(computedHash == bidCommit.commitment, "Invalid bid parameters or secret");
        require(bidCommit.deposit >= maxBid, "Deposit less than declared max bid");
        require(maxBid >= auction.startingPrice, "Bid below starting/reserve price");

        bidCommit.revealed = true;
        bidCommit.maxBid = maxBid;
        auction.revealedCount++;

        if (maxBid > auction.highestBid) {
            auction.secondHighestBid = auction.highestBid;
            auction.highestBid = maxBid;
            auction.highestBidder = msg.sender;
            emit BidRevealed(auctionId, msg.sender, maxBid, true);
        } else if (maxBid > auction.secondHighestBid) {
            auction.secondHighestBid = maxBid;
            emit BidRevealed(auctionId, msg.sender, maxBid, false);
        } else {
            emit BidRevealed(auctionId, msg.sender, maxBid, false);
        }
    }

    /**
     * @notice Settle the auction deterministically after reveal phase closes.
     */
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");
        require(block.timestamp >= auction.revealEndTime, "Reveal phase not finished");
        require(auction.state != AuctionState.Settled, "Auction already settled");

        auction.state = AuctionState.Settled;

        // If no valid revealed bids meet startingPrice — still apply anti-abort penalty
        if (auction.highestBidder == address(0)) {
            address[] memory bidders = auctionBidders[auctionId];
            for (uint256 i = 0; i < bidders.length; i++) {
                address bidder = bidders[i];
                BidCommitment memory b = commitments[auctionId][bidder];
                if (b.deposit > 0) {
                    uint256 refund;
                    if (b.revealed) {
                        // Revealed bidder played fair — full refund
                        refund = b.deposit;
                    } else {
                        // Non-reveal Anti-Abort Penalty: 5% deducted even with no winner
                        uint256 penalty = (b.deposit * 5) / 100;
                        refund = b.deposit - penalty;
                    }
                    if (refund > 0) {
                        pendingRefunds[bidder] += refund;
                        emit RefundAvailable(bidder, refund);
                    }
                }
            }
            emit AuctionSettled(auctionId, address(0), 0, 0);
            return;
        }

        // Vickrey Second-Price Rule: winning price is second highest revealed bid, or startingPrice if only 1 valid revealed bid
        uint256 winningPrice = auction.secondHighestBid > 0 ? auction.secondHighestBid : auction.startingPrice;

        // Pay seller the winning price
        (bool paidSeller, ) = auction.seller.call{value: winningPrice}("");
        require(paidSeller, "Seller transfer failed");

        // Calculate refunds & anti-abort non-reveal penalties
        address[] memory bidders = auctionBidders[auctionId];
        for (uint256 i = 0; i < bidders.length; i++) {
            address bidder = bidders[i];
            BidCommitment memory b = commitments[auctionId][bidder];

            if (bidder == auction.highestBidder) {
                uint256 winnerRefund = b.deposit - winningPrice;
                if (winnerRefund > 0) {
                    pendingRefunds[bidder] += winnerRefund;
                    emit RefundAvailable(bidder, winnerRefund);
                }
            } else if (b.revealed) {
                // Non-winning revealed bidder gets 100% deposit back
                if (b.deposit > 0) {
                    pendingRefunds[bidder] += b.deposit;
                    emit RefundAvailable(bidder, b.deposit);
                }
            } else {
                // Non-reveal Anti-Abort Penalty: 5% non-reveal penalty deducted, remaining 95% returned to user
                uint256 penalty = (b.deposit * 5) / 100;
                uint256 netRefund = b.deposit - penalty;
                if (netRefund > 0) {
                    pendingRefunds[bidder] += netRefund;
                    emit RefundAvailable(bidder, netRefund);
                }
            }
        }

        emit AuctionSettled(auctionId, auction.highestBidder, winningPrice, auction.secondHighestBid);
    }

    /**
     * @notice Pull-based refund withdrawal with checks-effects-interactions & reentrancy guard.
     */
    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        require(amount > 0, "No pending refund");

        // Effects
        pendingRefunds[msg.sender] = 0;

        // Interactions
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Refund transfer failed");

        emit RefundClaimed(msg.sender, amount);
    }

    /**
     * @notice Off-chain/on-chain helper to compute expected commitment hash.
     */
    function computeCommitment(
        uint256 auctionId,
        address bidder,
        uint256 maxBid,
        bytes32 secret
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(auctionId, bidder, maxBid, secret));
    }
}
