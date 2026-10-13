// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICredentialRegistryForRevoke {
    function revoke(address subject, bytes32 capabilityHash, uint256 nonce) external;
}

/// @title PasskeyIssuer
/// @notice ERC-1271 contract issuer for the Ligis CredentialRegistry. Instead of a
///         secp256k1 key in an env file, issuance is authorized by a WebAuthn/passkey
///         assertion, verified on-chain by Monad's native P256 precompile
///         (EIP-7951 at 0x0100, 160-byte input: hash ‖ r ‖ s ‖ qx ‖ qy).
///
///         Flow: `registerPasskey(keyId, qx, qy)` enrolls a WebAuthn public key.
///         `CredentialRegistry.issue(issuer=address(this), …, signature)` then carries
///         `signature = abi.encode(keyId, authenticatorData, clientDataJSON, r, s)`.
///         The registry calls `isValidSignature(digest, signature)`; we verify that
///         `clientDataJSON.challenge == base64url(digest)` (binding the assertion to
///         this exact credential) and that the authenticator signed
///         `sha256(authenticatorData ‖ sha256(clientDataJSON))` under a registered key.
///
///         Only the owner admits keys. All admitted keys share this issuer's authority,
///         including revocation, and are NOT isolated public-signup tenants.
///         Rotation requires owner removal followed by explicit re-enrollment.
contract PasskeyIssuer {
    address public constant P256_VERIFY = address(0x0100);
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_FAIL = 0xffffffff;

    struct Passkey {
        uint256 qx;
        uint256 qy;
    }

    /// @notice keyId → WebAuthn public key. keyId is chosen by the caller
    ///         (convention: keccak256(credentialId) or a UUID hash).
    mapping(bytes32 => Passkey) public passkeys;

    /// @notice Expected sha256 of the relying-party ID embedded in authenticatorData
    ///         (e.g. sha256("ligis.vercel.app")). The full origin is checked separately.
    bytes32 public rpIdHash;
    /// @notice sha256 of the exact serving origin, including scheme and port.
    /// Unconfigured originHash fails closed until the owner sets it.
    bytes32 public originHash;
    address public owner;
    uint256 internal constant P =
        0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff;
    uint256 internal constant B =
        0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b;

    event PasskeyRegistered(bytes32 indexed keyId, uint256 qx, uint256 qy);
    event PasskeyRemoved(bytes32 indexed keyId);

    error NotOwner();
    error UnknownPasskey(bytes32 keyId);
    error DuplicatePasskey(bytes32 keyId);
    error InvalidPublicKey();
    error InvalidContext();
    error InvalidKeyId();

    constructor(bytes32 _rpIdHash) {
        if (_rpIdHash == bytes32(0)) revert InvalidContext();
        rpIdHash = _rpIdHash;
        owner = msg.sender;
    }

    // ---------- enrollment ----------

    function registerPasskey(bytes32 keyId, uint256 qx, uint256 qy) external {
        if (msg.sender != owner) revert NotOwner();
        if (keyId == bytes32(0)) revert InvalidKeyId();
        if (passkeys[keyId].qx != 0 || passkeys[keyId].qy != 0) revert DuplicatePasskey(keyId);
        // Reject infinity, out-of-field coordinates and points off the P-256 curve.
        if (qx >= P || qy >= P || (qx == 0 && qy == 0)) revert InvalidPublicKey();
        uint256 rhs = addmod(
            addmod(mulmod(mulmod(qx, qx, P), qx, P), P - mulmod(3, qx, P), P), B, P
        );
        if (mulmod(qy, qy, P) != rhs) revert InvalidPublicKey();
        passkeys[keyId] = Passkey(qx, qy);
        emit PasskeyRegistered(keyId, qx, qy);
    }

    function removePasskey(bytes32 keyId) external {
        if (msg.sender != owner) revert NotOwner();
        delete passkeys[keyId];
        emit PasskeyRemoved(keyId);
    }

    function setRpIdHash(bytes32 _rpIdHash) external {
        if (msg.sender != owner) revert NotOwner();
        if (_rpIdHash == bytes32(0)) revert InvalidContext();
        rpIdHash = _rpIdHash;
    }

    function setOriginHash(bytes32 _originHash) external {
        if (msg.sender != owner) revert NotOwner();
        if (_originHash == bytes32(0)) revert InvalidContext();
        originHash = _originHash;
    }

    // ---------- ERC-1271 ----------

    /// @param digest The EIP-712 credential digest the registry wants authorized.
    /// @param signature abi.encode(keyId, authenticatorData, clientDataJSON, r, s)
    function isValidSignature(bytes32 digest, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        (
            bytes32 keyId,
            bytes memory authenticatorData,
            bytes memory clientDataJSON,
            uint256 r,
            uint256 s
        ) = abi.decode(signature, (bytes32, bytes, bytes, uint256, uint256));

        bool ok = _verifyAssertion(digest, keyId, authenticatorData, clientDataJSON, r, s);
        return ok ? ERC1271_MAGIC : ERC1271_FAIL;
    }

    // ---------- passkey-authorized revocation ----------

    /// @notice Revoke a credential this contract issued, authorized by a registered
    ///         passkey. The WebAuthn challenge binds a digest of the revoke intent.
    function revokeCredential(
        address registry,
        address subject,
        bytes32 capabilityHash,
        uint256 nonce,
        bytes32 keyId,
        bytes calldata authenticatorData,
        bytes calldata clientDataJSON,
        uint256 r,
        uint256 s
    ) external {
        bytes32 revokeDigest = keccak256(
            abi.encodePacked(
                "LigisPasskeyRevoke", address(this), registry, subject, capabilityHash, nonce, block.chainid
            )
        );
        if (!_verifyAssertion(revokeDigest, keyId, authenticatorData, clientDataJSON, r, s)) {
            revert UnknownPasskey(keyId); // generic fail: assertion did not verify
        }
        ICredentialRegistryForRevoke(registry).revoke(subject, capabilityHash, nonce);
    }

    // ---------- WebAuthn verification ----------

    function _verifyAssertion(
        bytes32 digest,
        bytes32 keyId,
        bytes memory authenticatorData,
        bytes memory clientDataJSON,
        uint256 r,
        uint256 s
    ) internal view returns (bool) {
        if (originHash == bytes32(0)) return false;
        Passkey memory pk = passkeys[keyId];
        if (pk.qx == 0 && pk.qy == 0) return false;

        // authenticatorData: rpIdHash(32) ‖ flags(1) ‖ signCount(4) ‖ …, min 37 bytes.
        if (authenticatorData.length < 37) return false;
        bytes32 gotRpIdHash;
        assembly {
            gotRpIdHash := mload(add(authenticatorData, 32))
        }
        if (gotRpIdHash != rpIdHash) return false;
        uint8 flags = uint8(authenticatorData[32]);
        if (flags & 0x05 != 0x05) return false; // require both presence AND verification
        if (flags & 0x10 != 0 && flags & 0x08 == 0) return false; // invalid backup flags

        // clientDataJSON must be a webauthn.get carrying challenge = base64url(digest).
        if (!_validClientData(clientDataJSON, digest)) return false;

        bytes32 msgHash =
            sha256(abi.encodePacked(authenticatorData, sha256(clientDataJSON)));
        return _p256(msgHash, r, s, pk.qx, pk.qy);
    }

    function _p256(bytes32 h, uint256 r, uint256 s, uint256 qx, uint256 qy)
        internal
        view
        returns (bool)
    {
        (bool ok, bytes memory ret) = P256_VERIFY.staticcall(
            abi.encodePacked(h, r, s, qx, qy)
        );
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @notice base64url (no padding) encoding of a 32-byte digest — the string a
    ///         WebAuthn client puts in clientDataJSON.challenge. Public so tests and
    ///         frontends can compute the expected challenge off-chain.
    function encodeChallenge(bytes32 digest) public pure returns (string memory) {
        bytes memory alphabet =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory out = new bytes(43);
        uint256 o = 0;
        uint256 i = 0;
        for (; i + 3 <= 32; i += 3) {
            uint256 v = (uint256(uint8(digest[i])) << 16)
                | (uint256(uint8(digest[i + 1])) << 8) | uint256(uint8(digest[i + 2]));
            out[o++] = alphabet[v >> 18];
            out[o++] = alphabet[(v >> 12) & 63];
            out[o++] = alphabet[(v >> 6) & 63];
            out[o++] = alphabet[v & 63];
        }
        // 32 % 3 == 2 remaining bytes → 3 output chars, no padding
        uint256 tail = (uint256(uint8(digest[30])) << 16) | (uint256(uint8(digest[31])) << 8);
        out[o++] = alphabet[tail >> 18];
        out[o++] = alphabet[(tail >> 12) & 63];
        out[o] = alphabet[(tail >> 6) & 63];
        return string(out);
    }

    /// @dev Deliberately supports only the compact browser serialization below,
    /// with optional crossOrigin:false and Chromium's known serialization sentinel.
    /// Rejects duplicate fields, nested substring tricks, escaped origins and
    /// unrecognized extensions rather than parsing loosely.
    function _validClientData(bytes memory json, bytes32 digest) internal view returns (bool) {
        bytes memory prefix = abi.encodePacked(
            '{"type":"webauthn.get","challenge":"', encodeChallenge(digest), '","origin":"'
        );
        if (json.length > 1024 || json.length <= prefix.length) return false;
        for (uint256 i; i < prefix.length; i++) {
            if (json[i] != prefix[i]) return false;
        }
        uint256 end = prefix.length;
        while (end < json.length && json[end] != '"') {
            if (json[end] == "\\" || uint8(json[end]) < 0x20) return false;
            end++;
        }
        if (end == json.length) return false;
        bytes memory origin = new bytes(end - prefix.length);
        for (uint256 i; i < origin.length; i++) origin[i] = json[prefix.length + i];
        if (sha256(origin) != originHash) return false;
        bytes memory suffix = new bytes(json.length - end);
        for (uint256 i; i < suffix.length; i++) suffix[i] = json[end + i];
        return keccak256(suffix) == keccak256(bytes('"}'))
            || keccak256(suffix) == keccak256(bytes('","crossOrigin":false}'))
            || keccak256(suffix) == keccak256(bytes('","other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}'))
            || keccak256(suffix) == keccak256(bytes('","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}'));
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x1626ba7e || iid == 0x01ffc9a7; // ERC-1271, ERC-165
    }
}
