// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../packages/contracts-evm/src/CredentialRegistry.sol";

contract CredentialRegistryTest is Test {
    CredentialRegistry internal registry;

    address internal issuer = makeAddr("issuer");
    address internal subject = makeAddr("subject");
    address internal other = makeAddr("other");

    bytes32 internal constant CAP = keccak256("agent.commerce.escrow");
    bytes32 internal constant CAP2 = keccak256("kyc.basic");

    uint64 internal constant ISSUED = 1_700_000_000;
    uint64 internal constant EXPIRES = 1_800_000_000;

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

    function setUp() public {
        registry = new CredentialRegistry();
        vm.warp(1_750_000_000);
    }

    function _signWithPrivKey(
        uint256 privKey,
        address _issuer,
        address _subject,
        bytes32 cap,
        uint64 issuedAt,
        uint64 expiresAt,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)"
                ),
                _issuer,
                _subject,
                cap,
                uint256(issuedAt),
                uint256(expiresAt),
                nonce
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_IssueCredential() public {
        uint256 issuerKey = 0xA11CE;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);

        vm.expectEmit(true, true, true, true);
        emit CredentialIssued(computedIssuer, subject, CAP, 0, ISSUED, EXPIRES);
        uint256 usedNonce = registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        assertEq(usedNonce, 0);
        assertEq(registry.issuerNonce(computedIssuer), 1);
        assertTrue(registry.isCapable(subject, CAP));
    }

    function test_IssueIncrementsNonce() public {
        uint256 issuerKey = 0xB0B;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig0 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig0);
        assertEq(registry.issuerNonce(computedIssuer), 1);

        bytes memory sig1 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP2, ISSUED, EXPIRES, 1);
        registry.issue(computedIssuer, subject, CAP2, ISSUED, EXPIRES, 1, sig1);
        assertEq(registry.issuerNonce(computedIssuer), 2);
    }

    function test_RevertWhen_ReplayAttack() public {
        uint256 issuerKey = 0xC0C;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        // Same sig with nonce 0 again should fail because issuerNonce has advanced
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_WrongSigner() public {
        uint256 issuerKey = 0xD0D;
        uint256 wrongKey = 0xBAD;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(wrongKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);

        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_AlreadyExpired() public {
        uint256 issuerKey = 0xE0E;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);

        // warp past expiry
        vm.warp(uint256(EXPIRES) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.Expired.selector, EXPIRES, uint64(block.timestamp)
            )
        );
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevertWhen_BadExpiry() public {
        uint256 issuerKey = 0xF0F;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, EXPIRES, ISSUED, 0);

        vm.expectRevert(CredentialRegistry.InvalidExpiry.selector);
        registry.issue(computedIssuer, subject, CAP, EXPIRES, ISSUED, 0, sig);
    }

    function test_RevertWhen_ZeroAddress() public {
        uint256 issuerKey = 0x111;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, address(0), CAP, ISSUED, EXPIRES, 0);

        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        registry.issue(computedIssuer, address(0), CAP, ISSUED, EXPIRES, 0, sig);
    }

    function test_RevokeCredential() public {
        uint256 issuerKey = 0x222;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        assertTrue(registry.isCapable(subject, CAP));

        vm.prank(computedIssuer);
        vm.expectEmit(true, true, true, true);
        emit CredentialRevoked(computedIssuer, subject, CAP, 0, uint64(block.timestamp));
        registry.revoke(subject, CAP, 0);

        assertFalse(registry.isCapable(subject, CAP));
    }

    function test_RevertWhen_RevokeByNonIssuer() public {
        uint256 issuerKey = 0x333;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistry.NotIssuer.selector, other, computedIssuer)
        );
        registry.revoke(subject, CAP, 0);
    }

    function test_RevertWhen_DoubleRevoke() public {
        uint256 issuerKey = 0x444;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);
        vm.prank(computedIssuer);
        registry.revoke(subject, CAP, 0);

        vm.prank(computedIssuer);
        vm.expectRevert(CredentialRegistry.AlreadyRevoked.selector);
        registry.revoke(subject, CAP, 0);
    }

    function test_ReissueAfterRevoke_ReplacesLatestValid() public {
        uint256 issuerKey = 0x555;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig0 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig0);
        vm.prank(computedIssuer);
        registry.revoke(subject, CAP, 0);

        // Issue a fresh one
        uint64 newIssued = uint64(block.timestamp);
        uint64 newExpires = newIssued + 1000;
        bytes memory sig1 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, newIssued, newExpires, 1);
        registry.issue(computedIssuer, subject, CAP, newIssued, newExpires, 1, sig1);

        assertTrue(registry.isCapable(subject, CAP));
    }

    function test_ExpiredCredentialReturnsInvalid() public {
        uint256 issuerKey = 0x666;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        assertTrue(registry.isCapable(subject, CAP));
        vm.warp(uint256(EXPIRES) + 1);
        assertFalse(registry.isCapable(subject, CAP));
    }

    function test_IsCapableFromIssuer() public {
        uint256 issuer1Key = 0x777;
        uint256 issuer2Key = 0x888;
        address issuer1 = vm.addr(issuer1Key);
        address issuer2 = vm.addr(issuer2Key);

        bytes memory sig = _signWithPrivKey(issuer1Key, issuer1, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(issuer1, subject, CAP, ISSUED, EXPIRES, 0, sig);

        assertTrue(registry.isCapableFromIssuer(subject, CAP, issuer1));
        assertFalse(registry.isCapableFromIssuer(subject, CAP, issuer2));
    }

    function test_LatestCredentialView() public {
        uint256 issuerKey = 0x999;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig);

        CredentialRegistry.CredentialView memory v = registry.latestCredential(subject, CAP);
        assertEq(v.issuer, computedIssuer);
        assertEq(v.issuedAt, ISSUED);
        assertEq(v.expiresAt, EXPIRES);
        assertFalse(v.revoked);
        assertTrue(v.valid);
    }

    function test_LatestCredentialViewUnknown() public view {
        CredentialRegistry.CredentialView memory v = registry.latestCredential(subject, CAP);
        assertEq(v.issuer, address(0));
        assertFalse(v.valid);
    }

    function test_HashTypedDataMatchesOffchain() public view {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)"
                ),
                issuer,
                subject,
                CAP,
                uint256(ISSUED),
                uint256(EXPIRES),
                uint256(0)
            )
        );
        bytes32 expectedDigest =
            keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        bytes32 actualDigest = registry.hashTypedData(issuer, subject, CAP, ISSUED, EXPIRES, 0);
        assertEq(actualDigest, expectedDigest);
    }

    function test_DifferentChainsHaveDifferentDomain() public {
        // The DOMAIN_SEPARATOR depends on block.chainid, so two deployments on different
        // chains produce different digests. A signature made on chain A cannot be replayed
        // on chain B. We simulate by deploying the same contract on two different chain IDs.
        bytes32 ds1 = registry.DOMAIN_SEPARATOR();

        vm.chainId(999_999);
        CredentialRegistry reg2 = new CredentialRegistry();
        assertTrue(ds1 != reg2.DOMAIN_SEPARATOR());
    }

    function test_MultipleSubjectsCoexist() public {
        uint256 issuerKey = 0xAAA;
        address computedIssuer = vm.addr(issuerKey);
        address subj2 = makeAddr("subj2");

        bytes memory sig1 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig1);

        bytes memory sig2 =
            _signWithPrivKey(issuerKey, computedIssuer, subj2, CAP, ISSUED, EXPIRES, 1);
        registry.issue(computedIssuer, subj2, CAP, ISSUED, EXPIRES, 1, sig2);

        assertTrue(registry.isCapable(subject, CAP));
        assertTrue(registry.isCapable(subj2, CAP));
        assertFalse(registry.isCapable(other, CAP));
    }

    function test_GetCredentialReturnsExactNonce() public {
        uint256 issuerKey = 0xBEEF;
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig0 =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, 0, sig0);

        CredentialRegistry.CredentialView memory missing = registry.getCredential(subject, CAP, 1);
        assertEq(missing.issuer, address(0));
        assertFalse(missing.valid);

        CredentialRegistry.CredentialView memory existing = registry.getCredential(subject, CAP, 0);
        assertEq(existing.issuer, computedIssuer);
        assertTrue(existing.valid);
    }

    function testFuzz_IssueCredentialWithValidSignature(
        uint128 rawKey,
        address fuzzSubject,
        bytes32 cap
    ) public {
        uint256 issuerKey = uint256(bound(rawKey, 1, type(uint128).max));
        address computedIssuer = vm.addr(issuerKey);
        vm.assume(fuzzSubject != address(0));
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, fuzzSubject, cap, ISSUED, EXPIRES, 0);

        uint256 usedNonce =
            registry.issue(computedIssuer, fuzzSubject, cap, ISSUED, EXPIRES, 0, sig);

        assertEq(usedNonce, 0);
        assertEq(registry.issuerNonce(computedIssuer), 1);
        assertTrue(registry.isCapable(fuzzSubject, cap));
        assertTrue(registry.isCapableFromIssuer(fuzzSubject, cap, computedIssuer));
    }

    function testFuzz_RevertWhen_NonceDoesNotMatchIssuerNonce(uint128 rawKey, uint64 nonce) public {
        uint256 issuerKey = uint256(bound(rawKey, 1, type(uint128).max));
        uint256 badNonce = uint256(bound(nonce, 1, type(uint64).max));
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, CAP, ISSUED, EXPIRES, badNonce);

        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        registry.issue(computedIssuer, subject, CAP, ISSUED, EXPIRES, badNonce, sig);
    }

    function testFuzz_RevokeIssuedCredential(uint128 rawKey, bytes32 cap) public {
        uint256 issuerKey = uint256(bound(rawKey, 1, type(uint128).max));
        address computedIssuer = vm.addr(issuerKey);
        bytes memory sig =
            _signWithPrivKey(issuerKey, computedIssuer, subject, cap, ISSUED, EXPIRES, 0);
        registry.issue(computedIssuer, subject, cap, ISSUED, EXPIRES, 0, sig);

        vm.prank(computedIssuer);
        registry.revoke(subject, cap, 0);

        assertFalse(registry.isCapable(subject, cap));
        assertFalse(registry.isCapableFromIssuer(subject, cap, computedIssuer));
        CredentialRegistry.CredentialView memory v = registry.getCredential(subject, cap, 0);
        assertTrue(v.revoked);
        assertFalse(v.valid);
    }
}
