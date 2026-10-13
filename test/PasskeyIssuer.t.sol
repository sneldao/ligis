// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../packages/contracts-evm/src/CredentialRegistry.sol";
import "../packages/contracts-evm/src/PasskeyIssuer.sol";

contract PasskeyIssuerTest is Test {
    CredentialRegistry internal registry;
    PasskeyIssuer internal issuer;

    address internal constant P256 = address(0x0100);
    bytes32 internal constant RP_HASH = sha256("ligis.test");
    bytes32 internal constant KEY_ID = keccak256("cred-1");
    uint256 internal constant QX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296;
    uint256 internal constant QY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5;
    uint256 internal constant R = 0x3333;
    uint256 internal constant S = 0x4444;

    address internal subject = makeAddr("subject");
    bytes32 internal constant CAP = keccak256("agent.commerce.escrow");

    uint64 internal constant ISSUED = 1_700_000_000;
    uint64 internal constant EXPIRES = 1_800_000_000;

    function setUp() public {
        registry = new CredentialRegistry();
        issuer = new PasskeyIssuer(RP_HASH);
        issuer.setOriginHash(sha256("https://ligis.test"));
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
                address(issuer),
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

    function test_UnauthorizedRegistrationAndReplacement() public {
        vm.startPrank(subject);
        vm.expectRevert(PasskeyIssuer.NotOwner.selector);
        issuer.registerPasskey(keccak256("public-signup"), QX, QY);
        vm.expectRevert(PasskeyIssuer.NotOwner.selector);
        issuer.registerPasskey(KEY_ID, QX, QY);
        vm.stopPrank();
    }

    function test_DuplicateCannotOverwrite() public {
        vm.expectRevert(abi.encodeWithSelector(PasskeyIssuer.DuplicatePasskey.selector, KEY_ID));
        issuer.registerPasskey(KEY_ID, QX, QY);
        (uint256 x, uint256 y) = issuer.passkeys(KEY_ID);
        assertEq(x, QX);
        assertEq(y, QY);
    }

    function test_InvalidPublicKeys() public {
        bytes32 id = keccak256("new");
        vm.expectRevert(PasskeyIssuer.InvalidPublicKey.selector);
        issuer.registerPasskey(id, 0, 0);
        vm.expectRevert(PasskeyIssuer.InvalidPublicKey.selector);
        issuer.registerPasskey(id, 1, 2);
        vm.expectRevert(PasskeyIssuer.InvalidPublicKey.selector);
        issuer.registerPasskey(id, type(uint256).max, QY);
        vm.expectRevert(PasskeyIssuer.InvalidKeyId.selector);
        issuer.registerPasskey(bytes32(0), QX, QY);
    }

    function test_RemovalThenExplicitReEnrollment() public {
        issuer.removePasskey(KEY_ID);
        issuer.registerPasskey(KEY_ID, QX, QY);
        (bytes memory sig,,) = _issueSignature(_issueDigest(0));
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        assertTrue(registry.isCapable(subject, CAP));
    }

    function _expectInvalid(bytes memory auth, bytes memory json) internal {
        _mockP256(sha256(abi.encodePacked(auth, sha256(json))));
        assertEq(issuer.isValidSignature(_issueDigest(0), abi.encode(KEY_ID, auth, json, R, S)), bytes4(0xffffffff));
    }

    function test_WrongRpAndRequiredFlags() public {
        bytes memory json = _clientDataJSON(_issueDigest(0));
        _expectInvalid(abi.encodePacked(sha256("wrong-rp"), bytes1(0x05), uint32(1)), json);
        _expectInvalid(abi.encodePacked(RP_HASH, bytes1(0x01), uint32(1)), json);
        _expectInvalid(abi.encodePacked(RP_HASH, bytes1(0x04), uint32(1)), json);
        _expectInvalid(abi.encodePacked(RP_HASH, bytes1(0x15), uint32(1)), json);
        _expectInvalid(bytes("short"), json);
    }

    function test_WrongOriginTypeAndDuplicateFields() public {
        bytes memory challenge = bytes(issuer.encodeChallenge(_issueDigest(0)));
        _expectInvalid(_authData(), abi.encodePacked('{"type":"webauthn.get","challenge":"', challenge, '","origin":"https://evil.test"}'));
        _expectInvalid(_authData(), abi.encodePacked('{"type":"webauthn.create","challenge":"', challenge, '","origin":"https://ligis.test"}'));
        _expectInvalid(_authData(), abi.encodePacked('{"type":"webauthn.get","challenge":"', challenge, '","origin":"https://ligis.test","origin":"https://evil.test"}'));
        _expectInvalid(_authData(), abi.encodePacked('{"type":"webauthn.get","challenge":"', challenge, '","origin":"https://ligis.test","crossOrigin":true}'));
    }

    function test_ReplayAndWrongChainRegistry() public {
        (bytes memory sig,,) = _issueSignature(_issueDigest(0));
        CredentialRegistry other = new CredentialRegistry();
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        other.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        uint256 originalChain = block.chainid;
        vm.chainId(originalChain + 1);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        vm.chainId(originalChain);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RemovedKeyCannotRevoke() public {
        (bytes memory sig,,) = _issueSignature(_issueDigest(0));
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        bytes32 digest = keccak256(abi.encodePacked("LigisPasskeyRevoke", address(issuer), address(registry), subject, CAP, uint256(0), block.chainid));
        bytes memory auth = _authData();
        bytes memory json = _clientDataJSON(digest);
        _mockP256(sha256(abi.encodePacked(auth, sha256(json))));
        issuer.removePasskey(KEY_ID);
        vm.expectRevert(abi.encodeWithSelector(PasskeyIssuer.UnknownPasskey.selector, KEY_ID));
        issuer.revokeCredential(address(registry), subject, CAP, 0, KEY_ID, auth, json, R, S);
        assertTrue(registry.isCapable(subject, CAP));
    }

    function test_RevokeRejectsWrongRegistryChainAndReplay() public {
        (bytes memory sig,,) = _issueSignature(_issueDigest(0));
        registry.issue(address(issuer), subject, CAP, ISSUED, EXPIRES, 0, sig);
        bytes32 digest = keccak256(abi.encodePacked("LigisPasskeyRevoke", address(issuer), address(registry), subject, CAP, uint256(0), block.chainid));
        bytes memory auth = _authData();
        bytes memory json = _clientDataJSON(digest);
        _mockP256(sha256(abi.encodePacked(auth, sha256(json))));
        vm.expectRevert(abi.encodeWithSelector(PasskeyIssuer.UnknownPasskey.selector, KEY_ID));
        issuer.revokeCredential(address(0x1234), subject, CAP, 0, KEY_ID, auth, json, R, S);
        uint256 chain = block.chainid;
        vm.chainId(chain + 1);
        vm.expectRevert(abi.encodeWithSelector(PasskeyIssuer.UnknownPasskey.selector, KEY_ID));
        issuer.revokeCredential(address(registry), subject, CAP, 0, KEY_ID, auth, json, R, S);
        vm.chainId(chain);
        issuer.revokeCredential(address(registry), subject, CAP, 0, KEY_ID, auth, json, R, S);
        vm.expectRevert(CredentialRegistry.AlreadyRevoked.selector);
        issuer.revokeCredential(address(registry), subject, CAP, 0, KEY_ID, auth, json, R, S);
    }

    function test_CompactBrowserCrossOriginFalseAccepted() public {
        bytes32 digest = _issueDigest(0);
        bytes memory auth = _authData();
        bytes memory json = abi.encodePacked('{"type":"webauthn.get","challenge":"', issuer.encodeChallenge(digest), '","origin":"https://ligis.test","crossOrigin":false}');
        _mockP256(sha256(abi.encodePacked(auth, sha256(json))));
        assertEq(issuer.isValidSignature(digest, abi.encode(KEY_ID, auth, json, R, S)), bytes4(0x1626ba7e));
    }

    function test_OriginConfigurationRequiresOwnerAndNonzeroHash() public {
        // Hash before arming: a precompile call would consume the expectation.
        bytes32 evilOriginHash = sha256("https://evil.test");
        vm.prank(subject);
        vm.expectRevert(PasskeyIssuer.NotOwner.selector);
        issuer.setOriginHash(evilOriginHash);
        vm.expectRevert(PasskeyIssuer.InvalidContext.selector);
        issuer.setOriginHash(bytes32(0));
    }

    function test_UnconfiguredOriginFailsClosed() public {
        PasskeyIssuer unconfigured = new PasskeyIssuer(RP_HASH);
        unconfigured.registerPasskey(KEY_ID, QX, QY);
        (bytes memory sig,,) = _issueSignature(_issueDigest(0));
        assertEq(unconfigured.isValidSignature(_issueDigest(0), sig), bytes4(0xffffffff));
    }

    function test_ChromiumSerializationSentinelAccepted() public {
        bytes32 digest = _issueDigest(0);
        bytes memory auth = _authData();
        bytes memory json = abi.encodePacked('{"type":"webauthn.get","challenge":"', issuer.encodeChallenge(digest), '","origin":"https://ligis.test","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}');
        _mockP256(sha256(abi.encodePacked(auth, sha256(json))));
        assertEq(issuer.isValidSignature(digest, abi.encode(KEY_ID, auth, json, R, S)), bytes4(0x1626ba7e));
    }
}
