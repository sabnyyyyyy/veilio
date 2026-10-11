// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VeilServiceRegistry
 * @notice On-chain seller identity and service listing registry for VEILIO marketplace.
 *         Makes service listings and seller identities verifiable on-chain for AI agents and buyers.
 *
 * @dev Architecture & Security Guarantees:
 * 1. Connected Wallet Identity: The seller's blockchain identity is msg.sender.
 * 2. Immutable Service ID: Once registered, a serviceId is uniquely bound to its seller.
 * 3. Verifiable Content Integrity: Stores a metadata content hash (SHA-256) and metadata URI (IPFS/off-chain).
 * 4. Seller-Controlled Lifecycle: Only the authorized seller can update metadata or toggle active/inactive status.
 * 5. Multi-Listing Support: A single seller can register and manage multiple service listings.
 * 6. Non-Custodial: Does not hold or transfer user funds; coordinates registry state only.
 */
contract VeilServiceRegistry {
    struct ServiceRecord {
        bytes32 serviceId;
        address seller;
        bytes32 metadataHash;
        string metadataURI;
        bool active;
        uint256 registeredAt;
        uint256 updatedAt;
    }

    // Mapping from serviceId => ServiceRecord
    mapping(bytes32 => ServiceRecord) public services;

    // Mapping from seller address => array of serviceIds
    mapping(address => bytes32[]) private _sellerServices;

    // Index tracking whether serviceId exists
    mapping(bytes32 => bool) public serviceExists;

    // Events
    event ServiceRegistered(
        bytes32 indexed serviceId,
        address indexed seller,
        bytes32 metadataHash,
        string metadataURI,
        uint256 timestamp
    );

    event ServiceMetadataUpdated(
        bytes32 indexed serviceId,
        address indexed seller,
        bytes32 newMetadataHash,
        string newMetadataURI,
        uint256 timestamp
    );

    event ServiceStatusChanged(
        bytes32 indexed serviceId,
        address indexed seller,
        bool active,
        uint256 timestamp
    );

    /**
     * @notice Registers a new service listing on-chain.
     * @param serviceId Unique 32-byte identifier for the service.
     * @param metadataHash Verifiable content hash (SHA-256) of canonical service metadata.
     * @param metadataURI Off-chain or IPFS URI pointing to full service metadata.
     */
    function registerService(
        bytes32 serviceId,
        bytes32 metadataHash,
        string calldata metadataURI
    ) external {
        require(serviceId != bytes32(0), "Invalid service ID");
        require(!serviceExists[serviceId], "Service already registered");
        require(metadataHash != bytes32(0), "Invalid metadata hash");
        require(bytes(metadataURI).length > 0, "Metadata URI required");

        ServiceRecord storage record = services[serviceId];
        record.serviceId = serviceId;
        record.seller = msg.sender;
        record.metadataHash = metadataHash;
        record.metadataURI = metadataURI;
        record.active = true;
        record.registeredAt = block.timestamp;
        record.updatedAt = block.timestamp;

        serviceExists[serviceId] = true;
        _sellerServices[msg.sender].push(serviceId);

        emit ServiceRegistered(
            serviceId,
            msg.sender,
            metadataHash,
            metadataURI,
            block.timestamp
        );
    }

    /**
     * @notice Updates metadata content hash and URI for an existing service listing.
     *         Only the registered seller can update their listing.
     * @param serviceId Service identifier to update.
     * @param newMetadataHash Updated metadata content hash.
     * @param newMetadataURI Updated metadata URI.
     */
    function updateServiceMetadata(
        bytes32 serviceId,
        bytes32 newMetadataHash,
        string calldata newMetadataURI
    ) external {
        require(serviceExists[serviceId], "Service not registered");
        ServiceRecord storage record = services[serviceId];
        require(msg.sender == record.seller, "Only seller can update service");
        require(newMetadataHash != bytes32(0), "Invalid metadata hash");
        require(bytes(newMetadataURI).length > 0, "Metadata URI required");

        record.metadataHash = newMetadataHash;
        record.metadataURI = newMetadataURI;
        record.updatedAt = block.timestamp;

        emit ServiceMetadataUpdated(
            serviceId,
            msg.sender,
            newMetadataHash,
            newMetadataURI,
            block.timestamp
        );
    }

    /**
     * @notice Activates or deactivates a service listing.
     *         Only the registered seller can modify status.
     * @param serviceId Service identifier.
     * @param active New active status.
     */
    function setServiceStatus(bytes32 serviceId, bool active) external {
        require(serviceExists[serviceId], "Service not registered");
        ServiceRecord storage record = services[serviceId];
        require(msg.sender == record.seller, "Only seller can update status");
        require(record.active != active, "Status already set to requested value");

        record.active = active;
        record.updatedAt = block.timestamp;

        emit ServiceStatusChanged(serviceId, msg.sender, active, block.timestamp);
    }

    /**
     * @notice Retrieves full service record.
     * @param serviceId Service identifier.
     */
    function getService(bytes32 serviceId) external view returns (ServiceRecord memory) {
        require(serviceExists[serviceId], "Service not registered");
        return services[serviceId];
    }

    /**
     * @notice Returns all service IDs registered by a specific seller.
     * @param seller Address of seller.
     */
    function getServicesBySeller(address seller) external view returns (bytes32[] memory) {
        return _sellerServices[seller];
    }

    /**
     * @notice Checks if a service is registered and active.
     * @param serviceId Service identifier.
     */
    function isServiceActive(bytes32 serviceId) external view returns (bool) {
        if (!serviceExists[serviceId]) return false;
        return services[serviceId].active;
    }
}
