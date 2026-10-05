// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBlindBid {
    function commitBid(uint256 auctionId, bytes32 commitment) external payable;
    function withdrawRefund() external;
}

/**
 * @title MaliciousReceiver
 * @notice Test-only helper: attempts reentrancy attack on BlindBid.withdrawRefund().
 * @dev Deployed only during Hardhat tests. Never deploy to mainnet.
 */
contract MaliciousReceiver {
    IBlindBid public immutable target;
    uint256 public attackCount;
    bool public reentrancyAttempted;

    constructor(address _target) {
        target = IBlindBid(_target);
    }

    /// @notice Commit a bid from this contract's address.
    function doCommit(uint256 auctionId, bytes32 commitment) external payable {
        target.commitBid{value: msg.value}(auctionId, commitment);
    }

    /// @notice Initiate the reentrancy attack by calling withdrawRefund.
    function attack() external {
        target.withdrawRefund();
    }

    /// @dev On first receipt of ETH, try to re-enter withdrawRefund.
    ///      The nonReentrant guard on BlindBid should block the second call.
    receive() external payable {
        attackCount++;
        if (attackCount == 1) {
            reentrancyAttempted = true;
            // Attempt re-entry — BlindBid.nonReentrant must block this
            try target.withdrawRefund() {} catch {}
        }
    }
}
