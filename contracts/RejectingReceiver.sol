// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RejectingReceiver
 * @notice Test-only helper: reverts on receiving BNB to test pull-payment fallback.
 */
contract RejectingReceiver {
    receive() external payable {
        revert("RejectingReceiver: rejects direct ETH transfer");
    }
}
