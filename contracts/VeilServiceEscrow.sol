// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 */
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

/**
 * @title VeilServiceEscrow
 * @notice Dedicated on-chain escrow holding buyer funds for VEILIO Services marketplace
 *         until the buyer approves deliverables or a dispute is resolved.
 *
 * @dev Architecture & Security Guarantees:
 * 1. Native BNB Escrow: Funds are held non-custodially inside the contract.
 * 2. Reentrancy Protection: All state-changing payment methods employ `nonReentrant`.
 * 3. Safe Transfer & Pull-Payment Fallback: If a direct transfer fails (e.g. non-payable smart contract
 *    wallet or gas limitation), funds are credited to `pendingWithdrawals` and can be claimed via `withdrawPending()`.
 *    This completely eliminates denial-of-service risks on payouts and dispute resolutions.
 * 4. Delivery Deadline Enforcement:
 *    - Sellers must submit deliverables on or before `order.deadline`.
 *    - Once in `Delivered` status, buyers cannot trigger a unilateral timeout refund; they must approve or dispute.
 *    - Buyers can only trigger timeout refunds if `order.status == EscrowStatus.Funded` and deadline has passed.
 * 5. Platform Fee:
 *    - Fee basis points capped at `MAX_FEE_BPS = 850` (8.5%).
 *    - Applied only to seller payouts in `releaseFunds` and `resolveDispute`.
 *    - Refunds are 100% fee-free for the buyer.
 *    - The fee rate is snapshotted per order at deposit (`orderFeeBps`); later `setFeeConfig` changes
 *      only affect new orders. The fee *recipient* is read at payout time (treasury rotation).
 * 7. Dispute Timeout:
 *    - `dispute` records `disputedAt`. If the reviewer has not resolved within `DISPUTE_TIMEOUT`
 *      (7 days), anyone may call `resolveDisputeTimeout`, which refunds 100% to the buyer fee-free
 *      (funds return to their origin, same default as the auction reviewer timeout).
 * 8. Order IDs:
 *    - `orderId` is a single global namespace (first depositor wins). A third party who learns an
 *      orderId before it is funded can front-run `deposit` with the same id so the real buyer's
 *      deposit reverts ("Order already exists in escrow"). No funds are at risk, but the off-chain
 *      order must then be re-funded under a fresh id. Clients should use unpredictable orderIds
 *      (e.g. random UUID / hash with salt) and verify `orders(orderId).buyer` after funding.
 *      Kept global (not buyer-namespaced) to stay ABI/storage-compatible with existing clients.
 * 9. Price Reductions:
 *    - `partialRefund` lets the seller return part of a Funded/Delivered order to the buyer (e.g. a
 *      lower price agreed in chat) without cancelling it. Seller-only: lowering the price can only
 *      benefit the buyer. The remaining `amount` stays escrowed and is what release/dispute settle.
 * 6. Access Control:
 *    - `owner`: Can update fee recipient, fee basis points (within cap), and reviewer.
 *    - `reviewer`: Third-party arbitrator who splits funds between buyer and seller in `resolveDispute`.
 *      Reviewer cannot redirect funds to themselves or third parties.
 */
contract VeilServiceEscrow is ReentrancyGuard {
    enum EscrowStatus {
        None,       // 0: Uninitialized
        Funded,     // 1: Buyer deposited funds, work in progress
        Released,   // 2: Buyer approved, payment released to seller
        Refunded,   // 3: Cancelled/refunded to buyer
        Disputed,   // 4: Escalated dispute, awaiting reviewer resolution
        Delivered   // 5: Seller submitted deliverables, awaiting buyer review
    }

    struct EscrowOrder {
        bytes32 orderId;
        address payable buyer;
        address payable seller;
        uint256 amount;
        uint256 deadline;
        EscrowStatus status;
        uint256 createdAt;
        uint256 settledAt;
        string deliverableReference;
    }

    address public owner;
    address public reviewer;
    address payable public feeRecipient;
    uint256 public platformFeeBasisPoints; // e.g. 100 = 1%
    uint256 public constant MAX_FEE_BPS = 850; // max 8.5%

    mapping(bytes32 => EscrowOrder) public orders;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    /// @notice Platform fee (bps) locked in for each order at deposit time.
    mapping(bytes32 => uint256) public orderFeeBps;
    /// @notice Timestamp at which an order entered Disputed.
    mapping(bytes32 => uint256) public disputedAt;

    event OrderFunded(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 deadline
    );
    event DeliverySubmitted(
        bytes32 indexed orderId,
        address indexed seller,
        string deliverableReference
    );
    event OrderReleased(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 sellerAmount,
        uint256 feeAmount
    );
    event OrderRefunded(
        bytes32 indexed orderId,
        address indexed buyer,
        uint256 refundAmount,
        string reason
    );
    event OrderDisputed(
        bytes32 indexed orderId,
        address indexed openedBy,
        string reason
    );
    event DisputeResolved(
        bytes32 indexed orderId,
        uint256 buyerShare,
        uint256 sellerShare
    );
    event WithdrawalPending(address indexed recipient, uint256 amount);
    event WithdrawalClaimed(address indexed recipient, uint256 amount);
    event FeeConfigUpdated(address feeRecipient, uint256 feeBps);
    event ReviewerUpdated(address newReviewer);
    event DisputeTimedOut(bytes32 indexed orderId, address indexed buyer, uint256 refundAmount);
    event OrderPartiallyRefunded(
        bytes32 indexed orderId,
        address indexed buyer,
        uint256 refundAmount,
        uint256 remainingAmount,
        string reason
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyReviewer() {
        require(msg.sender == reviewer || msg.sender == owner, "Only reviewer or owner");
        _;
    }

    constructor(
        address _reviewer,
        address payable _feeRecipient,
        uint256 _feeBps
    ) {
        require(_feeBps <= MAX_FEE_BPS, "Fee exceeds max");
        owner = msg.sender;
        reviewer = _reviewer != address(0) ? _reviewer : msg.sender;
        feeRecipient = _feeRecipient != address(0) ? _feeRecipient : payable(msg.sender);
        platformFeeBasisPoints = _feeBps;
    }

    /**
     * @dev Attempts direct transfer of native BNB. If the external call fails (e.g. non-payable recipient
     *      or gas limitation), credits pendingWithdrawals for pull-payment retrieval via withdrawPending().
     */
    function _safeTransferOrStore(address payable recipient, uint256 amount) internal {
        if (amount == 0 || recipient == address(0)) return;
        (bool sent, ) = recipient.call{value: amount}("");
        if (!sent) {
            pendingWithdrawals[recipient] += amount;
            emit WithdrawalPending(recipient, amount);
        }
    }

    /**
     * @notice Pull-payment mechanism to claim pending withdrawals if direct transfer previously failed.
     */
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdrawal transfer failed");

        emit WithdrawalClaimed(msg.sender, amount);
    }

    /**
     * @notice Deposits funds into escrow for a negotiated service order.
     * @param orderId Unique bytes32 order identifier.
     * @param seller The service provider address who will receive funds upon buyer approval.
     * @param deadline Unix timestamp by which the work must be submitted.
     */
    function deposit(
        bytes32 orderId,
        address payable seller,
        uint256 deadline
    ) external payable nonReentrant {
        require(orderId != bytes32(0), "Invalid orderId");
        require(seller != address(0), "Invalid seller address");
        require(seller != msg.sender, "Buyer cannot be seller");
        require(msg.value > 0, "Deposit amount must be > 0");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(orders[orderId].status == EscrowStatus.None, "Order already exists in escrow");

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: payable(msg.sender),
            seller: seller,
            amount: msg.value,
            deadline: deadline,
            status: EscrowStatus.Funded,
            createdAt: block.timestamp,
            settledAt: 0,
            deliverableReference: ""
        });
        orderFeeBps[orderId] = platformFeeBasisPoints;

        emit OrderFunded(orderId, msg.sender, seller, msg.value, deadline);
    }

    /**
     * @notice Seller submits delivery reference or cryptographic work proof.
     * @param orderId Order identifier.
     * @param deliverableReference URL, IPFS CID, hash, or cryptographic reference to the completed work.
     */
    function submitDelivery(bytes32 orderId, string calldata deliverableReference) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.Funded || order.status == EscrowStatus.Delivered, "Order is not funded");
        require(msg.sender == order.seller, "Only seller can submit deliverables");
        require(bytes(deliverableReference).length > 0, "Empty deliverable reference");
        require(block.timestamp <= order.deadline, "Delivery deadline has passed");

        order.deliverableReference = deliverableReference;
        order.status = EscrowStatus.Delivered;

        emit DeliverySubmitted(orderId, msg.sender, deliverableReference);
    }

    /**
     * @notice Releases escrowed funds to seller after buyer approves deliverables.
     * @param orderId Order identifier to release.
     */
    function releaseFunds(bytes32 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Funded || order.status == EscrowStatus.Delivered,
            "Order is not funded"
        );
        require(msg.sender == order.buyer, "Only buyer can approve and release funds");

        uint256 totalAmount = order.amount;
        require(totalAmount > 0, "Order amount is zero");

        uint256 fee = (totalAmount * orderFeeBps[orderId]) / 10000;
        uint256 sellerAmount = totalAmount - fee;

        order.amount = 0;
        order.status = EscrowStatus.Released;
        order.settledAt = block.timestamp;

        if (fee > 0 && feeRecipient != address(0)) {
            _safeTransferOrStore(feeRecipient, fee);
        }

        _safeTransferOrStore(order.seller, sellerAmount);

        emit OrderReleased(orderId, order.buyer, order.seller, sellerAmount, fee);
    }

    /**
     * @notice Internal refund execution.
     *         - Seller can cancel/refund at any time before final release/settlement.
     *         - Buyer can trigger timeout refund ONLY if order is still Funded and deadline has expired without delivery.
     */
    function _refundInternal(bytes32 orderId, string calldata reason) internal {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Funded || order.status == EscrowStatus.Delivered,
            "Order is not funded"
        );

        bool isSellerRefund = (msg.sender == order.seller);
        bool isBuyerTimeout = (msg.sender == order.buyer && order.status == EscrowStatus.Funded && block.timestamp > order.deadline);
        require(isSellerRefund || isBuyerTimeout, "Unauthorized refund: buyer timeout only allowed before delivery");

        uint256 refundAmount = order.amount;
        require(refundAmount > 0, "Order amount is zero");

        order.amount = 0;
        order.status = EscrowStatus.Refunded;
        order.settledAt = block.timestamp;

        _safeTransferOrStore(order.buyer, refundAmount);

        emit OrderRefunded(orderId, order.buyer, refundAmount, reason);
    }

    /**
     * @notice Refunds funds to buyer if seller consents or if past deadline without delivery.
     * @param orderId Order identifier to refund.
     * @param reason Description of refund reason.
     */
    function refund(bytes32 orderId, string calldata reason) external nonReentrant {
        _refundInternal(orderId, reason);
    }

    /**
     * @notice Cancels order and returns funds to buyer. Callable by seller anytime, or by buyer if deadline passed without delivery.
     */
    function cancelOrder(bytes32 orderId, string calldata reason) external nonReentrant {
        _refundInternal(orderId, reason);
    }

    /**
     * @notice Seller returns part of the escrowed amount to the buyer, keeping the order active.
     * @dev Use `refund`/`cancelOrder` to return everything; a partial refund must leave funds escrowed.
     * @param orderId Order identifier.
     * @param refundAmount Amount (wei) sent back to the buyer; must be > 0 and < current amount.
     * @param reason Description, e.g. the renegotiated price.
     */
    function partialRefund(bytes32 orderId, uint256 refundAmount, string calldata reason) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Funded || order.status == EscrowStatus.Delivered,
            "Order is not funded"
        );
        require(msg.sender == order.seller, "Only seller can partially refund");
        require(refundAmount > 0, "Refund amount must be > 0");
        require(refundAmount < order.amount, "Use refund for the full amount");

        order.amount -= refundAmount;
        _safeTransferOrStore(order.buyer, refundAmount);

        emit OrderPartiallyRefunded(orderId, order.buyer, refundAmount, order.amount, reason);
    }

    /**
     * @notice Flags an order as disputed, requiring designated reviewer resolution.
     */
    function dispute(bytes32 orderId, string calldata reason) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Funded || order.status == EscrowStatus.Delivered,
            "Order cannot be disputed in this state"
        );
        require(msg.sender == order.buyer || msg.sender == order.seller, "Only buyer or seller can dispute");

        order.status = EscrowStatus.Disputed;
        disputedAt[orderId] = block.timestamp;

        emit OrderDisputed(orderId, msg.sender, reason);
    }

    /**
     * @notice Liveness fallback when the reviewer does not resolve a dispute within DISPUTE_TIMEOUT.
     *         Callable by anyone; refunds 100% of the escrow to the buyer, fee-free.
     */
    function resolveDisputeTimeout(bytes32 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.Disputed, "Order is not in disputed state");
        require(block.timestamp >= disputedAt[orderId] + DISPUTE_TIMEOUT, "Dispute review period still active");

        uint256 refundAmount = order.amount;
        require(refundAmount > 0, "Order amount is zero");

        order.amount = 0;
        order.status = EscrowStatus.Refunded;
        order.settledAt = block.timestamp;

        _safeTransferOrStore(order.buyer, refundAmount);

        emit DisputeResolved(orderId, refundAmount, 0);
        emit DisputeTimedOut(orderId, order.buyer, refundAmount);
    }

    /**
     * @notice Reviewer resolves a dispute, splitting the escrowed funds between buyer and seller.
     * @param orderId Order identifier.
     * @param splitToBuyerPercent Percentage of funds returned to buyer (0 to 100). Remainder sent to seller.
     */
    function resolveDispute(bytes32 orderId, uint8 splitToBuyerPercent) external onlyReviewer nonReentrant {
        require(splitToBuyerPercent <= 100, "Split percent must be 0..100");
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.Disputed, "Order is not in disputed state");

        uint256 totalAmount = order.amount;
        require(totalAmount > 0, "Order amount is zero");

        uint256 buyerShare = (totalAmount * splitToBuyerPercent) / 100;
        uint256 sellerShare = totalAmount - buyerShare;

        order.amount = 0;
        order.status = splitToBuyerPercent == 100 ? EscrowStatus.Refunded : EscrowStatus.Released;
        order.settledAt = block.timestamp;

        // Platform fee applies to the seller payout share
        uint256 fee = (sellerShare * orderFeeBps[orderId]) / 10000;
        uint256 netSellerShare = sellerShare - fee;

        if (fee > 0 && feeRecipient != address(0)) {
            _safeTransferOrStore(feeRecipient, fee);
        }

        if (buyerShare > 0) {
            _safeTransferOrStore(order.buyer, buyerShare);
        }

        if (netSellerShare > 0) {
            _safeTransferOrStore(order.seller, netSellerShare);
        }

        emit DisputeResolved(orderId, buyerShare, sellerShare);
    }

    function getOrder(bytes32 orderId) external view returns (EscrowOrder memory) {
        return orders[orderId];
    }

    /// @notice Updates the fee recipient and the fee rate for orders deposited from now on.
    function setFeeConfig(address payable _feeRecipient, uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee exceeds max");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        feeRecipient = _feeRecipient;
        platformFeeBasisPoints = _feeBps;
        emit FeeConfigUpdated(_feeRecipient, _feeBps);
    }

    function setReviewer(address _newReviewer) external onlyOwner {
        require(_newReviewer != address(0), "Invalid reviewer");
        reviewer = _newReviewer;
        emit ReviewerUpdated(_newReviewer);
    }
}
