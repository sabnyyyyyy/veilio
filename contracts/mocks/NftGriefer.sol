// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test-only actor: a contract wallet that can act as seller or bidder (via `exec`) and then
///      refuse incoming NFTs, either by reverting or by burning all forwarded gas.
contract NftGriefer {
    // 0 = accept, 1 = revert, 2 = burn all gas
    uint8 public mode;

    function setMode(uint8 newMode) external {
        mode = newMode;
    }

    function exec(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function _react() internal view {
        if (mode == 1) revert("NftGriefer: rejecting NFT");
        if (mode == 2) {
            uint256 x;
            while (gasleft() > 0) {
                x++;
            }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        _react();
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        _react();
        return this.onERC1155Received.selector;
    }

    receive() external payable {}
}
