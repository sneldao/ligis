// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../packages/contracts-evm/src/PharosAgentID.sol";
import "../packages/contracts-evm/src/CredentialRegistry.sol";

contract DeployIdentitySkill is Script {
    function run() external {
        // Resolve the deployer key from env (PRIVATE_KEY or DEPLOYER_KEY) or from the
        // broadcast context set by `forge script --private-key <KEY>` / --account.
        uint256 deployerKey;
        try vm.envUint("PRIVATE_KEY") returns (uint256 k) {
            deployerKey = k;
        } catch {
            try vm.envUint("DEPLOYER_KEY") returns (uint256 k) {
                deployerKey = k;
            } catch {
                revert("set PRIVATE_KEY or DEPLOYER_KEY env var (or pass --private-key to forge script)");
            }
        }
        address deployer = vm.addr(deployerKey);

        console.log("Deploying Pharos Agent Identity Skill");
        console.log("  Deployer:    ", deployer);
        console.log("  Chain ID:    ", block.chainid);

        vm.startBroadcast(deployerKey);

        PharosAgentID id = new PharosAgentID();
        console.log("  PharosAgentID:      ", address(id));

        CredentialRegistry registry = new CredentialRegistry();
        console.log("  CredentialRegistry: ", address(registry));

        vm.stopBroadcast();

        // Write a minimal per-chain deployment record to DEPLOYMENT_OUT. The wrapper
        // shell script (scripts/deploy.sh) merges this into assets/networks.json via jq
        // so multiple chains (e.g. atlantic + mainnet + local-anvil) coexist.
        // Format: a single JSON object (not wrapped in deployment:{...}).
        string memory networkKey;
        if (block.chainid == 688689) {
            networkKey = "atlantic-testnet";
        } else if (block.chainid == 1672) {
            networkKey = "mainnet";
        } else {
            networkKey = "local-anvil";
        }

        string memory dep = string.concat(
            '{"network":"', networkKey, '",',
            '"pharosAgentId":"', vm.toString(address(id)), '",',
            '"credentialRegistry":"', vm.toString(address(registry)), '",',
            '"chainId":', vm.toString(block.chainid), ',',
            '"deployer":"', vm.toString(deployer), '",',
            '"deployedAt":"', vm.toString(block.timestamp), '"}'
        );

        string memory path = vm.envOr("DEPLOYMENT_OUT", string("./.deployment-latest.json"));
        vm.writeFile(path, dep);
        console.log("  Manifest:   ", path);
    }
}
