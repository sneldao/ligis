// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../packages/contracts-evm/src/CredentialRegistry.sol";
import "../packages/contracts-evm/src/PasskeyIssuer.sol";

/// @notice Metropolis build: deploy CredentialRegistry v2 (ERC-1271 contract issuers)
///         + PasskeyIssuer (WebAuthn/P256 via the 0x0100 precompile) on Monad.
///         PharosAgentID is unchanged — the existing deployment stays registered.
contract DeployMonadV2 is Script {
    function run() external {
        uint256 deployerKey;
        try vm.envUint("PRIVATE_KEY") returns (uint256 k) {
            deployerKey = k;
        } catch {
            try vm.envUint("DEPLOYER_KEY") returns (uint256 k) {
                deployerKey = k;
            } catch {
                revert("set PRIVATE_KEY or DEPLOYER_KEY env var");
            }
        }
        address deployer = vm.addr(deployerKey);

        // WebAuthn rpId — the domain the passkey ceremony runs on. Owner can
        // rotate with setRpIdHash (e.g. sha256("localhost") for local dev).
        bytes32 rpIdHash = sha256("ligis.vercel.app");

        console.log("Deploying Ligis Metropolis v2 (ERC-1271 + PasskeyIssuer)");
        console.log("  Deployer:    ", deployer);
        console.log("  Chain ID:    ", block.chainid);

        vm.startBroadcast(deployerKey);

        CredentialRegistry registry = new CredentialRegistry();
        console.log("  CredentialRegistry v2:", address(registry));

        PasskeyIssuer passkeyIssuer = new PasskeyIssuer(rpIdHash);
        console.log("  PasskeyIssuer:        ", address(passkeyIssuer));

        vm.stopBroadcast();

        string memory dep = string.concat(
            '{"network":"',
            block.chainid == 10143 ? "monad-testnet" : block.chainid == 143
                ? "monad-mainnet"
                : vm.toString(block.chainid),
            '",',
            '"credentialRegistry":"',
            vm.toString(address(registry)),
            '",',
            '"passkeyIssuer":"',
            vm.toString(address(passkeyIssuer)),
            '",',
            '"rpId":"ligis.vercel.app",',
            '"chainId":',
            vm.toString(block.chainid),
            ",",
            '"deployer":"',
            vm.toString(deployer),
            '",',
            '"deployedAt":"',
            vm.toString(block.timestamp),
            '"}'
        );

        string memory path = vm.envOr("DEPLOYMENT_OUT", string("./.deployment-latest.json"));
        vm.writeFile(path, dep);
        console.log("  Manifest:   ", path);
    }
}
