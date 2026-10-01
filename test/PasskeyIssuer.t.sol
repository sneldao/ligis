// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../packages/contracts-evm/src/CredentialRegistry.sol";
import "../packages/contracts-evm/src/PasskeyIssuer.sol";

contract PasskeyIssuerTest is Test {
    CredentialRegistry internal registry;
    PasskeyIssuer internal issuer;

    address internal constant P256 = address(0x0100);
    bytes32 internal constant RP_HASH = keccak256("ligis.test");
    bytes32 internal constant KEY_ID = keccak256("cred-1");
    uint256 internal constant QX = 0x1111;
    uint256 internal constant QY = 0x2222;
    uint256 internal constant R = 0x3333;
    uint256 internal constant S = 0x4444;

    address internal subject = makeAddr("subject");
    bytes32 internal constant CAP = keccak256("agent.commerce.escrow");

    uint64 internal constant ISSUED = 1_700_000_000;
    uint64 internal constant EXPIRES = 1_800_000_000;

    function setUp() public {
        registry = new CredentialRegistry();
        issuer = new PasskeyIssuer(RP_HASH);
        vm.warp(1_750_000_000);
        issuer.registerPasskey(KEY_ID, QX, QY);
    }

    function _authData() internal pure returns (bytes memory) {
        return abi.encodePacked(RP_HASH, bytes1(0x05), uint32(1)); // UP|UV
    }

    function _clientDataJSON(bytes32 digest) internal view returns (bytes memory) {
        return abi.encodePacked(
            '{"type":"webauthn.get","challenge":"',
            issuer.encodeChallenge(digest),
            '","origin":"https://ligis.test"}'
        );
    }

    function _mockP256(bytes32 msgHash) internal {
        vm.mockCall(
            P256, abi.encodePacked(msgHash, R, S, QX, QY), abi.encode(uint256(1))
        );
    }

    function _issueDigest(uint256 nonce) internal view returns (bytes32) {
        return registry.hashTypedData(
            address(issuer), subject, CAP, ISSUED, EXPIRES, nonce
        );
    }

    function _issueSignature(bytes32 digest)
        internal
        returns (bytes memory signature, bytes memory authData, bytes memory cjson)
    {
        authData = _authData();
        cjson = _clientDataJSON(digest);
        bytes32 msgHash = sha256(abi.encodePacked(authData, sha256(cjson)));
        _mockP256(msgHash);
        signature = abi.encode(KEY_ID, authData, cjson, R, S);
    }

    function test_IssueViaPasskeyIssuer() public {
        bytes32 digest = _issueDigest(0);
        (bytes memory sig,,) = _issueSignature(digest);

        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);

        assertTrue(registry.isCapable(subject, CAP));
        assertTrue(registry.isCapableFromIssuer(subject, CAP, address(issuer)));
        CredentialRegistry.CredentialView memory v = registry.latestCredential(subject, CAP);
        assertEq(v.issuer, address(issuer));
    }

    function test_RevertWhen_ChallengeMismatch() public {
        bytes32 digest = _issueDigest(0);
        // Sign a DIFFERENT digest's challenge — the assertion doesn't bind this credential.
        bytes32 otherDigest = keccak256("not-this-credential");
        (bytes memory sig, bytes memory authData, bytes memory cjson) =
            _issueSignature(otherDigest);
        bytes32 msgHash = sha256(abi.encodePacked(authData, sha256(cjson)));
        _mockP256(msgHash);
        sig = sig; // silence unused warnings

        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        digest;
    }

    function test_RevertWhen_UnregisteredKey() public {
        bytes32 digest = _issueDigest(0);
        (bytes memory sig,,) = _issueSignature(digest);
        bytes32 unknownKey = keccak256("cred-unknown");
        // Rebuild signature with an unregistered keyId; the P256 mock is irrelevant.
        (, , bytes memory cjson) = (sig, sig, sig); // keep compiler happy
        bytes memory authData = _authData();
        sig = abi.encode(unknownKey, authData, cjson, R, S);

        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_P256Rejects() public {
        bytes32 digest = _issueDigest(0);
        bytes memory authData = _authData();
        bytes memory cjson = _clientDataJSON(digest);
        bytes32 msgHash = sha256(abi.encodePacked(authData, sha256(cjson)));
        // Precompile returns failure (empty) — e.g. wrong signature bytes.
        vm.mockCall(P256, abi.encodePacked(msgHash, R, S, QX, QY), bytes(""));
        bytes memory sig = abi.encode(KEY_ID, authData, cjson, R, S);

        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_IssuerContractNot1271() public {
        // Any contract that doesn't answer isValidSignature correctly must fail.
        bytes memory sig = abi.encode(KEY_ID, _authData(), bytes("{}"), R, S);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(registry), subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevokeViaPasskeyIssuer() public {
        bytes32 digest = _issueDigest(0);
        (bytes memory sig,,) = _issueSignature(digest);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        assertTrue(registry.isCapable(subject, CAP));

        bytes32 revokeDigest = keccak256(
            abi.encodePacked(
                "LigisPasskeyRevoke",
                address(registry),
                subject,
                CAP,
                uint256(0),
                block.chainid
            )
        );
        bytes memory authData = _authData();
        bytes memory cjson = _clientDataJSON(revokeDigest);
        bytes32 msgHash = sha256(abi.encodePacked(authData, sha256(cjson)));
        _mockP256(msgHash);

        issuer.revokeCredential(
            address(registry), subject, CAP, 0, KEY_ID, authData, cjson, R, S
        );

        assertFalse(registry.isCapable(subject, CAP));
    }

    function test_EncodeChallengeLength() public view {
        string memory c = issuer.encodeChallenge(bytes32(uint256(1)));
        assertEq(bytes(c).length, 43);
        // must be URL-safe base64 — no '+' '/' '=' chars
        bytes memory b = bytes(c);
        for (uint256 i = 0; i < b.length; i++) {
            assertTrue(b[i] != "+" && b[i] != "/" && b[i] != "=");
        }
    }

    function test_EncodeChallengeKnownVector() public view {
        // base64url(0x0000...0000) = "AAAA...A" (43 chars, no padding)
        string memory c = issuer.encodeChallenge(bytes32(0));
        assertEq(c, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    }

    function test_RemovePasskey() public {
        issuer.removePasskey(KEY_ID);
        bytes32 digest = _issueDigest(0);
        (bytes memory sig,,) = _issueSignature(digest);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_RemovePasskeyNotOwner() public {
        vm.prank(subject);
        vm.expectRevert(PasskeyIssuer.NotOwner.selector);
        issuer.removePasskey(KEY_ID);
    }

    function test_EoaIssuerPathUnchanged() public {
        // Contract-issuer branch must not affect EOA issuers.
        uint256 issuerKey = 0xA11CE;
        address eoa = vm.addr(issuerKey);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)"
                ),
                eoa,
                subject,
                CAP,
                uint256(ISSUED),
                uint256(EXPIRES),
                uint256(0)
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        registry.issue(eoa, subject, CAP, ISSUED, EXPIRES, 0, abi.encodePacked(r, s, v));
        assertTrue(registry.isCapable(subject, CAP));
    }
}
