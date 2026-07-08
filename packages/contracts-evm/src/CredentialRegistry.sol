// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CredentialRegistry
/// @notice EIP-712 verifiable credential registry for the Pharos Agent Identity Skill. An authorized
///         `issuer` (e.g. a KYC provider, a DAO, a marketplace) signs an attestation stating that
///         `subject` (an agent's controller wallet) holds a given `capability`. Other Skills (Aegis,
///         FaroLink, Maestro, etc.) gate access by calling `isCapable`.
///
///         Each `(subject, capabilityHash, issuer, nonce)` is a single credential. The latest
///         non-revoked, non-expired credential from a given issuer wins. Issuers can revoke their
///         own credentials at any time. The contract is non-custodial: it never holds funds.
contract CredentialRegistry {
    struct Credential {
        address issuer;
        address subject;
        bytes32 capabilityHash;
        uint64 issuedAt;
        uint64 expiresAt;
        uint64 revokedAt; // 0 == not revoked
        uint64 nonce;
    }

    struct CredentialView {
        address issuer;
        uint64 issuedAt;
        uint64 expiresAt;
        bool revoked;
        bool valid;
    }

    bytes32 private constant CREDENTIAL_TYPEHASH = keccak256(
        "Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)"
    );
    uint256 private constant MAX_REVOKE_SCAN = 50;

    // issuer => nonce (each issuer keeps its own counter; this is the nonce the issuer must include)
    mapping(address => uint256) public issuerNonce;

    // subject => capabilityHash => credentialNonce => Credential
    mapping(address => mapping(bytes32 => mapping(uint256 => Credential))) private _credentials;

    // existence flag: at least one non-revoked, non-expired credential exists for (subject, cap).
    // We need this separate from `_latestValidNonce` because a credential issued with nonce 0 is
    // indistinguishable from "no credential" if we only check the nonce value.
    mapping(address => mapping(bytes32 => bool)) private _hasValid;
    mapping(address => mapping(bytes32 => bool)) private _hasCredential;

    // quick existence flags so verify() doesn't have to iterate
    mapping(address => mapping(bytes32 => uint256)) private _latestNonce; // newest issued
    mapping(address => mapping(bytes32 => uint256)) private _latestValidNonce; // newest not revoked & not expired
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _hasValidFromIssuer;
    mapping(address => mapping(bytes32 => mapping(address => uint256))) private
        _latestValidNonceFromIssuer;

    event CredentialIssued(
        address indexed issuer,
        address indexed subject,
        bytes32 indexed capabilityHash,
        uint256 nonce,
        uint64 issuedAt,
        uint64 expiresAt
    );
    event CredentialRevoked(
        address indexed issuer,
        address indexed subject,
        bytes32 indexed capabilityHash,
        uint256 nonce,
        uint64 revokedAt
    );
    event AgentCapabilityChanged(
        address indexed subject, bytes32 indexed capabilityHash, bool capable
    );

    error Expired(uint64 expiresAt, uint64 nowTs);
    error NotIssuer(address caller, address issuer);
    error InvalidSignature();
    error InvalidExpiry();
    error ZeroAddress();
    error AlreadyRevoked();
    error UnknownCredential();

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("PharosAgentCredential")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Issue a credential. Caller submits a signed EIP-712 attestation from `issuer`. The
    ///         `nonce` must equal the issuer's current `issuerNonce` to prevent replay across
    ///         contexts. Anyone may submit the signed attestation (it's public), but only the
    ///         issuer can sign it. Auto-increments `issuerNonce[issuer]`.
    function issue(
        address issuer,
        address subject,
        bytes32 capabilityHash,
        uint64 issuedAt,
        uint64 expiresAt,
        uint256 nonce,
        bytes calldata signature
    ) external returns (uint256 usedNonce) {
        if (issuer == address(0) || subject == address(0)) {
            revert ZeroAddress();
        }
        if (expiresAt <= issuedAt) revert InvalidExpiry();
        if (block.timestamp > expiresAt) revert Expired(expiresAt, uint64(block.timestamp));
        if (nonce != issuerNonce[issuer]) revert InvalidSignature();

        bytes32 structHash = keccak256(
            abi.encode(
                CREDENTIAL_TYPEHASH, issuer, subject, capabilityHash, issuedAt, expiresAt, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));

        address recovered = _recover(digest, signature);
        if (recovered != issuer) revert InvalidSignature();

        _credentials[subject][capabilityHash][nonce] = Credential({
            issuer: issuer,
            subject: subject,
            capabilityHash: capabilityHash,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            revokedAt: 0,
            nonce: uint64(nonce)
        });

        if (
            !_hasCredential[subject][capabilityHash]
                || nonce > _latestNonce[subject][capabilityHash]
        ) {
            _latestNonce[subject][capabilityHash] = nonce;
        }
        _hasCredential[subject][capabilityHash] = true;
        // The new credential is valid (just issued, not revoked, not expired). Track it.
        _latestValidNonce[subject][capabilityHash] = nonce;
        _hasValid[subject][capabilityHash] = true;
        _latestValidNonceFromIssuer[subject][capabilityHash][issuer] = nonce;
        _hasValidFromIssuer[subject][capabilityHash][issuer] = true;

        issuerNonce[issuer] = nonce + 1;

        emit CredentialIssued(issuer, subject, capabilityHash, nonce, issuedAt, expiresAt);
        emit AgentCapabilityChanged(subject, capabilityHash, true);
        return nonce;
    }

    /// @notice Revoke a previously-issued credential. Only the original issuer may revoke.
    ///         Revocation is permanent and the credential is no longer valid.
    function revoke(address subject, bytes32 capabilityHash, uint256 nonce) external {
        Credential storage cred = _credentials[subject][capabilityHash][nonce];
        if (cred.issuer == address(0)) revert UnknownCredential();
        if (msg.sender != cred.issuer) revert NotIssuer(msg.sender, cred.issuer);
        if (cred.revokedAt != 0) revert AlreadyRevoked();

        cred.revokedAt = uint64(block.timestamp);

        if (_latestValidNonceFromIssuer[subject][capabilityHash][cred.issuer] == nonce) {
            _hasValidFromIssuer[subject][capabilityHash][cred.issuer] = false;
            _latestValidNonceFromIssuer[subject][capabilityHash][cred.issuer] = 0;
        }

        // If this was the "latest valid" entry, recompute by scanning a bounded recent window.
        if (_latestValidNonce[subject][capabilityHash] == nonce) {
            _hasValid[subject][capabilityHash] = false;
            _latestValidNonce[subject][capabilityHash] = 0;
            uint256 top = _latestNonce[subject][capabilityHash];
            uint256 scanned = 0;
            for (uint256 i = top;; i--) {
                if (scanned >= MAX_REVOKE_SCAN) break;
                scanned++;
                Credential storage c = _credentials[subject][capabilityHash][i];
                if (c.issuer != address(0) && c.revokedAt == 0 && block.timestamp <= c.expiresAt) {
                    _hasValid[subject][capabilityHash] = true;
                    _latestValidNonce[subject][capabilityHash] = i;
                    break;
                }
                if (i == 0) break;
            }
        }

        emit CredentialRevoked(cred.issuer, subject, capabilityHash, nonce, cred.revokedAt);
        // Check if the subject is still capable after this revocation
        bool stillCapable =
            _hasValid[subject][capabilityHash] && _latestValidNonce[subject][capabilityHash] != 0;
        emit AgentCapabilityChanged(subject, capabilityHash, stillCapable);
    }

    // ---------- Read API used by other Skills (Aegis, FaroLink, ...) ----------

    /// @notice Returns true if the subject currently holds a valid (non-revoked, non-expired)
    ///         credential for the given capability from any issuer.
    function isCapable(address subject, bytes32 capabilityHash) external view returns (bool) {
        if (!_hasValid[subject][capabilityHash]) return false;
        uint256 nonce = _latestValidNonce[subject][capabilityHash];
        Credential storage c = _credentials[subject][capabilityHash][nonce];
        if (c.issuer == address(0)) return false;
        if (c.revokedAt != 0) return false;
        if (block.timestamp > c.expiresAt) return false;
        return true;
    }

    /// @notice Returns true if a specific issuer has a valid credential for subject + capability.
    ///         Useful for Skills that only accept credentials from a known issuer (e.g. a DAO,
    ///         a KYC provider, a marketplace operator).
    function isCapableFromIssuer(address subject, bytes32 capabilityHash, address issuer)
        external
        view
        returns (bool)
    {
        if (!_hasValidFromIssuer[subject][capabilityHash][issuer]) return false;
        uint256 nonce = _latestValidNonceFromIssuer[subject][capabilityHash][issuer];
        Credential storage c = _credentials[subject][capabilityHash][nonce];
        if (c.issuer != issuer) return false;
        if (c.revokedAt != 0) return false;
        if (block.timestamp > c.expiresAt) return false;
        return true;
    }

    /// @notice Read the latest credential view for a (subject, capability) pair, regardless of
    ///         validity. Used by UIs and Agents that want to surface status.
    function latestCredential(address subject, bytes32 capabilityHash)
        external
        view
        returns (CredentialView memory)
    {
        if (!_hasCredential[subject][capabilityHash]) {
            return CredentialView(address(0), 0, 0, false, false);
        }
        uint256 nonce = _latestNonce[subject][capabilityHash];
        Credential storage c = _credentials[subject][capabilityHash][nonce];
        if (c.issuer == address(0)) return CredentialView(address(0), 0, 0, false, false);
        bool valid = c.revokedAt == 0 && block.timestamp <= c.expiresAt;
        return CredentialView(c.issuer, c.issuedAt, c.expiresAt, c.revokedAt != 0, valid);
    }

    function getCredential(address subject, bytes32 capabilityHash, uint256 nonce)
        external
        view
        returns (CredentialView memory)
    {
        Credential storage c = _credentials[subject][capabilityHash][nonce];
        if (c.issuer == address(0)) return CredentialView(address(0), 0, 0, false, false);
        bool valid = c.revokedAt == 0 && block.timestamp <= c.expiresAt;
        return CredentialView(c.issuer, c.issuedAt, c.expiresAt, c.revokedAt != 0, valid);
    }

    /// @notice Batch check: returns an array of booleans for each capability hash.
    ///         Saves N-1 RPC calls for the Trust Steward's GATE phase.
    function isCapableMulti(address subject, bytes32[] calldata capabilityHashes)
        external
        view
        returns (bool[] memory results)
    {
        results = new bool[](capabilityHashes.length);
        for (uint256 i = 0; i < capabilityHashes.length; i++) {
            bytes32 cap = capabilityHashes[i];
            if (!_hasValid[subject][cap]) {
                results[i] = false;
                continue;
            }
            uint256 nonce = _latestValidNonce[subject][cap];
            Credential storage c = _credentials[subject][cap][nonce];
            results[i] =
                c.issuer != address(0) && c.revokedAt == 0 && block.timestamp <= c.expiresAt;
        }
    }

    // ---------- ERC-165 ----------

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7; // ERC-165
    }

    // ---------- EIP-712 helpers ----------

    function hashTypedData(
        address issuer,
        address subject,
        bytes32 capabilityHash,
        uint256 issuedAt,
        uint256 expiresAt,
        uint256 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                CREDENTIAL_TYPEHASH, issuer, subject, capabilityHash, issuedAt, expiresAt, nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
                v := byte(0, calldataload(add(signature.offset, 64)))
            }
            if (v < 27) v += 27;
            return ecrecover(digest, v, r, s);
        }
        revert InvalidSignature();
    }
}
