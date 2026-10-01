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
///         Registration is open: enrollment is what makes a passkey able to authorize
///         issuance, and consumers that need issuer-level trust should gate on
///         `isCapableFromIssuer(subject, cap, address(this))` plus operator review.
///         The owner can remove a compromised key and rotate the RP-ID hash.
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
    ///         (e.g. sha256("ligis.vercel.app")). Binds assertions to this origin.
    bytes32 public rpIdHash;
    address public owner;

    event PasskeyRegistered(bytes32 indexed keyId, uint256 qx, uint256 qy);
    event PasskeyRemoved(bytes32 indexed keyId);

    error NotOwner();
    error UnknownPasskey(bytes32 keyId);

    constructor(bytes32 _rpIdHash) {
        rpIdHash = _rpIdHash;
        owner = msg.sender;
    }

    // ---------- enrollment ----------

    function registerPasskey(bytes32 keyId, uint256 qx, uint256 qy) external {
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
        rpIdHash = _rpIdHash;
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
                "LigisPasskeyRevoke", registry, subject, capabilityHash, nonce, block.chainid
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
        if (flags & 0x01 == 0) return false; // user-presence flag required

        // clientDataJSON must be a webauthn.get carrying challenge = base64url(digest).
        if (!_contains(clientDataJSON, '"type":"webauthn.get"')) return false;
        bytes memory challenge = _extractChallenge(clientDataJSON);
        bytes memory expected = bytes(encodeChallenge(digest));
        if (challenge.length != expected.length) return false;
        if (keccak256(challenge) != keccak256(expected)) return false;

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

    function _extractChallenge(bytes memory json) internal pure returns (bytes memory) {
        bytes memory marker = bytes('"challenge":"');
        for (uint256 i = 0; i + marker.length <= json.length; i++) {
            bool matchAll = true;
            for (uint256 j = 0; j < marker.length; j++) {
                if (json[i + j] != marker[j]) {
                    matchAll = false;
                    break;
                }
            }
            if (!matchAll) continue;
            uint256 start = i + marker.length;
            uint256 end = start;
            while (end < json.length && json[end] != '"') end++;
            bytes memory out = new bytes(end - start);
            for (uint256 k = start; k < end; k++) out[k - start] = json[k];
            return out;
        }
        return new bytes(0);
    }

    function _contains(bytes memory haystack, bytes memory needle)
        internal
        pure
        returns (bool)
    {
        if (needle.length > haystack.length) return false;
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool matchAll = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matchAll = false;
                    break;
                }
            }
            if (matchAll) return true;
        }
        return false;
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x1626ba7e || iid == 0x01ffc9a7; // ERC-1271, ERC-165
    }
}
