// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Veil V2
 * @notice Trustless Sealed Maximum-Price Auction Marketplace with Dataset Inspection & Dispute Review.
 * @dev Enforces state machine transitions, sealed keccak256 maximum bids, Vickrey second-price pricing,
 * non-reveal penalties, dataset inspection window, refund requests, and review finalization.
 */
contract VeilV2 {
    enum AuctionState { Created, Bidding, Revealing, Inspection, RefundRequested, UnderReview, Completed, Refunded, Cancelled }

    struct Auction {
        uint256 id;
        address payable seller;
        string itemName;
        string description;
        string imageURI; // metadata URI
        uint256 startingPrice; // Reserve price
        uint256 commitEndTime;
        uint256 revealEndTime;
        uint256 inspectionDuration;
        uint256 inspectionEndTime;
        AuctionState state;
        address highestBidder;
        uint256 highestBid;
        uint256 secondHighestBid;
        uint256 bidderCount;
        uint256 revealedCount;
        bytes32 finalTxHash;
        string evidenceHash; // Off-chain evidence for dispute
        string reviewReason; // On-chain reason for refund rejection
    }

    struct BidCommitment {
        bytes32 commitment;
        uint256 deposit;
        bool revealed;
        uint256 maxBid;
    }

    uint256 public auctionCount;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => BidCommitment)) public commitments;
    mapping(uint256 => address[]) public auctionBidders;
    mapping(address => uint256) public pendingRefunds;

    address public reviewer; // Centralized VEIL reviewer for MVP
    address public feeRecipient; // Destination for platform fees
    uint256 public constant PLATFORM_FEE_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Reentrancy Guard
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, string itemName, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration);
    event BidCommitted(uint256 indexed auctionId, address indexed bidder, bytes32 commitment, uint256 deposit);
    event BidRevealed(uint256 indexed auctionId, address indexed bidder, uint256 maxBid, bool isCurrentHighest);
    event AuctionSettledToInspection(uint256 indexed auctionId, address indexed winner, uint256 winningPrice, uint256 inspectionEndTime);
    event RefundAvailable(address indexed account, uint256 amount);
    event RefundClaimed(address indexed account, uint256 amount);
    event DatasetAccepted(uint256 indexed auctionId, address indexed winner);
    event RefundRequested(uint256 indexed auctionId, address indexed winner, string evidenceHash);
    event RefundResolved(uint256 indexed auctionId, bool approved, string reason);
    event AuctionCompleted(uint256 indexed auctionId, address indexed seller, uint256 sellerAmount, uint256 platformFee);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyReviewer() {
        require(msg.sender == reviewer, "Not authorized: Reviewer only");
        _;
    }

    constructor(address _reviewer, address _feeRecipient) {
        _status = _NOT_ENTERED;
        reviewer = _reviewer;
        feeRecipient = _feeRecipient;
    }

    function getAuctionState(uint256 auctionId) public view returns (AuctionState) {
        Auction memory auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");

        if (auction.state == AuctionState.Completed || auction.state == AuctionState.Refunded || auction.state == AuctionState.Cancelled || auction.state == AuctionState.RefundRequested || auction.state == AuctionState.UnderReview) {
            return auction.state;
        }

        if (block.timestamp < auction.commitEndTime) {
            return AuctionState.Bidding;
        } else if (block.timestamp < auction.revealEndTime) {
            return AuctionState.Revealing;
        } else if (auction.state == AuctionState.Inspection) {
            if (block.timestamp < auction.inspectionEndTime) {
                return AuctionState.Inspection;
            } else {
                return AuctionState.Inspection; // Needs finalizeSettlement to move to Completed
            }
        }
        
        return AuctionState.Revealing; // Ready to be settled into inspection
    }

    function createAuction(
        string memory itemName,
        string memory description,
        string memory imageURI,
        uint256 startingPrice,
        uint256 commitDuration,
        uint256 revealDuration,
        uint256 inspectionDuration
    ) external returns (uint256 auctionId) {
        require(commitDuration >= 60, "Commit duration too short");
        require(revealDuration >= 60, "Reveal duration too short");
        require(inspectionDuration >= 3600, "Inspection duration too short (min 1h)");

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
            inspectionDuration: inspectionDuration,
            inspectionEndTime: 0,
            state: AuctionState.Created,
            highestBidder: address(0),
            highestBid: 0,
            secondHighestBid: 0,
            bidderCount: 0,
            revealedCount: 0,
            finalTxHash: bytes32(0),
            evidenceHash: "",
            reviewReason: ""
        });

        emit AuctionCreated(auctionId, msg.sender, itemName, startingPrice, auctions[auctionId].commitEndTime, auctions[auctionId].revealEndTime, inspectionDuration);
    }

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

    function revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret) external nonReentrant {
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

    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.id != 0, "Auction does not exist");
        require(block.timestamp >= auction.revealEndTime, "Reveal phase not finished");
        require(auction.state == AuctionState.Created, "Auction already settled"); // Note: Created state acts as "active" before settled

        // If no valid revealed bids, cancel
        if (auction.highestBidder == address(0)) {
            auction.state = AuctionState.Completed; // No winner, just complete
            
            address[] memory allBidders = auctionBidders[auctionId];
            for (uint256 i = 0; i < allBidders.length; i++) {
                address bidder = allBidders[i];
                BidCommitment memory b = commitments[auctionId][bidder];
                if (b.deposit > 0) {
                    uint256 refund;
                    if (b.revealed) {
                        refund = b.deposit;
                    } else {
                        // 5% penalty for non-reveal
                        uint256 penalty = (b.deposit * 5) / 100;
                        refund = b.deposit - penalty;
                    }
                    if (refund > 0) {
                        pendingRefunds[bidder] += refund;
                        emit RefundAvailable(bidder, refund);
                    }
                }
            }
            emit AuctionCompleted(auctionId, address(0), 0, 0);
            return;
        }

        auction.state = AuctionState.Inspection;
        auction.inspectionEndTime = block.timestamp + auction.inspectionDuration;

        uint256 winningPrice = auction.secondHighestBid > 0 ? auction.secondHighestBid : auction.startingPrice;

        // Refund losing bidders, and the difference for winner
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
                if (b.deposit > 0) {
                    pendingRefunds[bidder] += b.deposit;
                    emit RefundAvailable(bidder, b.deposit);
                }
            } else {
                uint256 penalty = (b.deposit * 5) / 100;
                uint256 netRefund = b.deposit - penalty;
                if (netRefund > 0) {
                    pendingRefunds[bidder] += netRefund;
                    emit RefundAvailable(bidder, netRefund);
                }
            }
        }

        emit AuctionSettledToInspection(auctionId, auction.highestBidder, winningPrice, auction.inspectionEndTime);
    }

    function acceptDataset(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.state == AuctionState.Inspection, "Not in inspection phase");
        require(msg.sender == auction.highestBidder, "Only winner can accept");
        
        _processSuccessfulSettlement(auctionId);
        emit DatasetAccepted(auctionId, msg.sender);
    }

    function requestRefund(uint256 auctionId, string memory evidenceHash) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.state == AuctionState.Inspection, "Not in inspection phase");
        require(block.timestamp <= auction.inspectionEndTime, "Inspection period has ended");
        require(msg.sender == auction.highestBidder, "Only winner can request refund");

        auction.state = AuctionState.RefundRequested;
        auction.evidenceHash = evidenceHash;

        emit RefundRequested(auctionId, msg.sender, evidenceHash);
    }
    
    // For MVP, VEIL manually sets to UnderReview when they start looking
    function markUnderReview(uint256 auctionId) external onlyReviewer {
        Auction storage auction = auctions[auctionId];
        require(auction.state == AuctionState.RefundRequested, "Refund not requested");
        auction.state = AuctionState.UnderReview;
    }

    function resolveRefund(uint256 auctionId, bool approved, string memory reason) external nonReentrant onlyReviewer {
        Auction storage auction = auctions[auctionId];
        require(auction.state == AuctionState.UnderReview, "Refund must be UnderReview to resolve");

        uint256 winningPrice = auction.secondHighestBid > 0 ? auction.secondHighestBid : auction.startingPrice;

        if (approved) {
            auction.state = AuctionState.Refunded;
            pendingRefunds[auction.highestBidder] += winningPrice;
            emit RefundAvailable(auction.highestBidder, winningPrice);
        } else {
            require(bytes(reason).length > 0, "Must provide a rejection reason");
            auction.reviewReason = reason;
            // Rejected, proceed to successful settlement
            _processSuccessfulSettlement(auctionId);
        }

        emit RefundResolved(auctionId, approved, reason);
    }

    function finalizeSettlement(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.state == AuctionState.Inspection, "Not in inspection phase");
        require(block.timestamp > auction.inspectionEndTime, "Inspection period has not ended");

        _processSuccessfulSettlement(auctionId);
    }

    function _processSuccessfulSettlement(uint256 auctionId) internal {
        Auction storage auction = auctions[auctionId];
        auction.state = AuctionState.Completed;

        uint256 winningPrice = auction.secondHighestBid > 0 ? auction.secondHighestBid : auction.startingPrice;
        
        uint256 platformFee = (winningPrice * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = winningPrice - platformFee;

        // Pay seller (push to pendingRefunds to avoid push-reentrancy on seller or use call)
        pendingRefunds[auction.seller] += sellerAmount;
        emit RefundAvailable(auction.seller, sellerAmount);

        // Pay platform fee (VEIL admin/feeRecipient)
        pendingRefunds[feeRecipient] += platformFee;
        emit RefundAvailable(feeRecipient, platformFee);

        emit AuctionCompleted(auctionId, auction.seller, sellerAmount, platformFee);
    }

    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        require(amount > 0, "No pending refund");

        pendingRefunds[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Refund transfer failed");

        emit RefundClaimed(msg.sender, amount);
    }

    function computeCommitment(uint256 auctionId, address bidder, uint256 maxBid, bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(auctionId, bidder, maxBid, secret));
    }
}
