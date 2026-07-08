// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PharosAgentID
/// @notice Minimal ERC-721 soulbound-style NFT that mints a portable agent identifier bound to a
///         controller wallet. Used as the anchor identity for the Pharos Agent Identity Skill. One ID per
///         agent. The NFT owner is the agent's controller; key rotation is `transferFrom`; revocation
///         is `burn`. Off-chain metadata (name, description, capabilities index) lives at `tokenURI`.
/// @dev Intentionally simple so it composes with any wallet, Safe, or session-key module. The
///      `CredentialRegistry` looks up IDs by wallet via `walletOfAgent`.
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

contract PharosAgentID {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event AgentMinted(uint256 indexed tokenId, address indexed controller, string tokenURI);
    event AgentRotated(uint256 indexed tokenId, address indexed from, address indexed to);
    event AgentRevoked(uint256 indexed tokenId, address indexed controller);
    event MetadataUpdated(uint256 indexed tokenId, string newTokenURI);

    error AlreadyHasID(address controller);
    error NotController(address caller, uint256 tokenId);
    error DoesNotExist(uint256 tokenId);
    error ZeroAddress();

    string public name = "Pharos Agent ID";
    string public symbol = "PAID";

    uint256 private _nextId = 1;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _tokenOfWallet;
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Mint a new agent ID bound to `controller`. Reverts if the wallet already holds an ID.
    function mint(address controller, string calldata tokenURI_) public returns (uint256 tokenId) {
        if (controller == address(0)) revert ZeroAddress();
        if (_tokenOfWallet[controller] != 0) revert AlreadyHasID(controller);

        tokenId = _nextId++;
        _owners[tokenId] = controller;
        _tokenOfWallet[controller] = tokenId;
        _tokenURIs[tokenId] = tokenURI_;

        emit Transfer(address(0), controller, tokenId);
        emit AgentMinted(tokenId, controller, tokenURI_);
    }

    /// @notice Mint to the caller. Convenience for agents registering themselves.
    function mintSelf(string calldata tokenURI_) external returns (uint256 tokenId) {
        return mint(msg.sender, tokenURI_);
    }

    /// @notice Rotate the controller of an agent ID. Caller must be the current controller.
    ///         This is the canonical "key rotation" path: the NFT moves to the new key, all
    ///         off-chain reputation and on-chain credentials that resolve by `walletOfAgent`
    ///         now resolve to the new controller.
    function rotate(uint256 tokenId, address newController) external {
        if (newController == address(0)) revert ZeroAddress();
        address current = _owners[tokenId];
        if (current == address(0)) revert DoesNotExist(tokenId);
        if (current != msg.sender) revert NotController(msg.sender, tokenId);
        if (_tokenOfWallet[newController] != 0) revert AlreadyHasID(newController);

        delete _tokenOfWallet[current];
        _owners[tokenId] = newController;
        _tokenOfWallet[newController] = tokenId;

        emit Transfer(current, newController, tokenId);
        emit AgentRotated(tokenId, current, newController);
    }

    /// @notice Revoke (burn) an agent ID. Caller must be the current controller.
    function revoke(uint256 tokenId) external {
        address current = _owners[tokenId];
        if (current == address(0)) revert DoesNotExist(tokenId);
        if (current != msg.sender) revert NotController(msg.sender, tokenId);

        delete _owners[tokenId];
        delete _tokenOfWallet[current];
        delete _tokenURIs[tokenId];

        emit Transfer(current, address(0), tokenId);
        emit AgentRevoked(tokenId, current);
    }

    /// @notice Update the off-chain metadata URI. Caller must be the current controller.
    function setTokenURI(uint256 tokenId, string calldata newURI) external {
        address current = _owners[tokenId];
        if (current == address(0)) revert DoesNotExist(tokenId);
        if (current != msg.sender) revert NotController(msg.sender, tokenId);

        _tokenURIs[tokenId] = newURI;
        emit MetadataUpdated(tokenId, newURI);
    }

    // ---------- ERC-721 minimal view surface ----------

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _tokenOfWallet[owner] == 0 ? 0 : 1;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert DoesNotExist(tokenId);
        return owner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert DoesNotExist(tokenId);
        return _tokenURIs[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextId - 1;
    }

    // ---------- Identity-specific lookups ----------

    /// @notice Returns the agent ID for a controller wallet, or 0 if none.
    function walletOfAgent(address controller) external view returns (uint256) {
        return _tokenOfWallet[controller];
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    // ---------- Standard ERC-721 transfer (needed for Safe / wallet support) ----------

    function approve(address, uint256) external pure {
        revert("PharosAgentID: approvals disabled - use rotate()");
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function setApprovalForAll(address, bool) external pure {
        revert("PharosAgentID: approvals disabled - use rotate()");
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address current = _owners[tokenId];
        if (current == address(0)) revert DoesNotExist(tokenId);
        if (current != from) revert NotController(from, tokenId);
        if (msg.sender != from) revert NotController(msg.sender, tokenId);
        if (_tokenOfWallet[to] != 0) revert AlreadyHasID(to);

        delete _tokenOfWallet[from];
        _owners[tokenId] = to;
        _tokenOfWallet[to] = tokenId;

        emit Transfer(from, to, tokenId);
        emit AgentRotated(tokenId, from, to);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data)
        external
    {
        transferFrom(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, data);
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        internal
    {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (
            bytes4 retval
        ) {
            require(
                retval == IERC721Receiver.onERC721Received.selector,
                "PharosAgentID: unsafe recipient"
            );
        } catch (bytes memory reason) {
            if (reason.length == 0) revert("PharosAgentID: non-ERC721Receiver");
            assembly {
                revert(add(32, reason), mload(reason))
            }
        }
    }

    // ERC-165
    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7 || iid == 0x80ac58cd || iid == 0x5b5e139f;
    }
}
