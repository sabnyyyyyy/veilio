// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC721ReceiverMock {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

interface IERC1155ReceiverMock {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data) external returns (bytes4);
}

/// @dev Minimal test token. Do not use for production assets.
contract MockERC721 {
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => bool)) private _operators;

    function mint(address to, uint256 tokenId) external {
        require(to != address(0) && _owners[tokenId] == address(0), "Invalid mint");
        _owners[tokenId] = to;
        _balances[to]++;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Nonexistent token");
        return owner;
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(_owners[tokenId] == from && (_operators[from][msg.sender] || msg.sender == from), "Not authorized");
        require(to != address(0), "Invalid recipient");
        _owners[tokenId] = to;
        _balances[from]--;
        _balances[to]++;
        if (to.code.length > 0) {
            require(IERC721ReceiverMock(to).onERC721Received(msg.sender, from, tokenId, "") == IERC721ReceiverMock.onERC721Received.selector, "Unsafe recipient");
        }
    }
}

/// @dev Minimal test token. Do not use for production assets.
contract MockERC1155 {
    mapping(uint256 => mapping(address => uint256)) private _balances;
    mapping(address => mapping(address => bool)) private _operators;

    function mint(address to, uint256 id, uint256 amount) external {
        require(to != address(0) && amount > 0, "Invalid mint");
        _balances[id][to] += amount;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[id][account];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        require(_operators[from][msg.sender] || msg.sender == from, "Not authorized");
        require(to != address(0) && _balances[id][from] >= amount, "Invalid transfer");
        _balances[id][from] -= amount;
        _balances[id][to] += amount;
        if (to.code.length > 0) {
            require(IERC1155ReceiverMock(to).onERC1155Received(msg.sender, from, id, amount, data) == IERC1155ReceiverMock.onERC1155Received.selector, "Unsafe recipient");
        }
    }
}
