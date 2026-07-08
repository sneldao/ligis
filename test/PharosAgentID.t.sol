// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../packages/contracts-evm/src/PharosAgentID.sol";

contract GoodReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract BadReceiver {}

contract PharosAgentIDTest is Test {
    PharosAgentID internal id;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event AgentMinted(uint256 indexed tokenId, address indexed controller, string tokenURI);
    event AgentRotated(uint256 indexed tokenId, address indexed from, address indexed to);
    event AgentRevoked(uint256 indexed tokenId, address indexed controller);

    function setUp() public {
        id = new PharosAgentID();
    }

    function test_Mint() public {
        vm.expectEmit(true, true, true, true);
        emit Transfer(address(0), alice, 1);
        vm.expectEmit(true, true, false, true);
        emit AgentMinted(1, alice, "ipfs://meta-1");
        uint256 tokenId = id.mint(alice, "ipfs://meta-1");

        assertEq(tokenId, 1);
        assertEq(id.ownerOf(1), alice);
        assertEq(id.balanceOf(alice), 1);
        assertEq(id.walletOfAgent(alice), 1);
        assertEq(id.tokenURI(1), "ipfs://meta-1");
        assertEq(id.totalSupply(), 1);
    }

    function test_MintSelf() public {
        vm.prank(alice);
        uint256 tokenId = id.mintSelf("ipfs://self");
        assertEq(id.ownerOf(tokenId), alice);
    }

    function test_RevertWhen_DoubleMint() public {
        id.mint(alice, "ipfs://a");
        vm.expectRevert(abi.encodeWithSelector(PharosAgentID.AlreadyHasID.selector, alice));
        id.mint(alice, "ipfs://b");
    }

    function test_RevertWhen_ZeroController() public {
        vm.expectRevert(PharosAgentID.ZeroAddress.selector);
        id.mint(address(0), "ipfs://x");
    }

    function test_Rotate() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Transfer(alice, bob, 1);
        vm.expectEmit(true, true, true, false);
        emit AgentRotated(1, alice, bob);
        id.rotate(1, bob);

        assertEq(id.ownerOf(1), bob);
        assertEq(id.walletOfAgent(alice), 0);
        assertEq(id.walletOfAgent(bob), 1);
    }

    function test_RotateViaTransferFrom() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Transfer(alice, bob, 1);
        id.transferFrom(alice, bob, 1);
        assertEq(id.ownerOf(1), bob);
    }

    function test_SafeTransferToReceiverContract() public {
        GoodReceiver receiver = new GoodReceiver();
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        id.safeTransferFrom(alice, address(receiver), 1);
        assertEq(id.ownerOf(1), address(receiver));
    }

    function test_RevertWhen_SafeTransferToNonReceiverContract() public {
        BadReceiver receiver = new BadReceiver();
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectRevert(bytes("PharosAgentID: non-ERC721Receiver"));
        id.safeTransferFrom(alice, address(receiver), 1);
    }

    function test_RevertWhen_RotateByNonController() public {
        id.mint(alice, "ipfs://a");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PharosAgentID.NotController.selector, bob, 1));
        id.rotate(1, carol);
    }

    function test_RevertWhen_RotateToAddressWithID() public {
        id.mint(alice, "ipfs://a");
        id.mint(bob, "ipfs://b");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PharosAgentID.AlreadyHasID.selector, bob));
        id.rotate(1, bob);
    }

    function test_RevertWhen_RotateToZero() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectRevert(PharosAgentID.ZeroAddress.selector);
        id.rotate(1, address(0));
    }

    function test_Revoke() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Transfer(alice, address(0), 1);
        vm.expectEmit(true, true, false, false);
        emit AgentRevoked(1, alice);
        id.revoke(1);

        assertEq(id.walletOfAgent(alice), 0);
        assertEq(id.balanceOf(alice), 0);
    }

    function test_RevertWhen_RevokeByNonController() public {
        id.mint(alice, "ipfs://a");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PharosAgentID.NotController.selector, bob, 1));
        id.revoke(1);
    }

    function test_ReMintAfterRevoke() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        id.revoke(1);
        // After revoke, alice should be able to mint again with a new tokenId
        uint256 newId = id.mint(alice, "ipfs://b");
        assertEq(newId, 2);
        assertEq(id.walletOfAgent(alice), 2);
    }

    function test_ApprovalsAreDisabled() public {
        id.mint(alice, "ipfs://a");
        vm.expectRevert(bytes("PharosAgentID: approvals disabled - use rotate()"));
        id.approve(bob, 1);
        vm.expectRevert(bytes("PharosAgentID: approvals disabled - use rotate()"));
        id.setApprovalForAll(bob, true);
    }

    function test_OwnerOfNonexistentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PharosAgentID.DoesNotExist.selector, 99));
        id.ownerOf(99);
    }

    function test_TokenURIUpdate() public {
        id.mint(alice, "ipfs://a");
        vm.prank(alice);
        id.setTokenURI(1, "ipfs://b");
        assertEq(id.tokenURI(1), "ipfs://b");
    }

    function test_SupportsERC721Interface() public view {
        assertTrue(id.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(id.supportsInterface(0x80ac58cd)); // ERC-721
    }

    function test_NameAndSymbol() public view {
        assertEq(id.name(), "Pharos Agent ID");
        assertEq(id.symbol(), "PAID");
    }
}
