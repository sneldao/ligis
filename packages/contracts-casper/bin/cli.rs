//! CLI tool for ligis-contracts-casper smart contracts.
//!
//! Provides deploy and interact commands for the AgentId and
//! CredentialRegistry contracts via the odra-cli framework.

use ligis_contracts_casper::agent_id::AgentId;
use ligis_contracts_casper::credential_registry::CredentialRegistry;
use odra::host::{HostEnv, NoArgs};
use odra::schema::casper_contract_schema::NamedCLType;
use odra_cli::{
    deploy::DeployScript,
    scenario::{Args, Error, Scenario, ScenarioMetadata},
    CommandArg, ContractProvider, DeployedContractsContainer, DeployerExt,
    OdraCli,
};

/// Deploys both Ligis contracts (AgentId + CredentialRegistry).
pub struct LigisDeployScript;

impl DeployScript for LigisDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let _agent_id = AgentId::load_or_deploy(&env, NoArgs, container, 500_000_000_000)?;
        let _credential_registry =
            CredentialRegistry::load_or_deploy(&env, NoArgs, container, 500_000_000_000)?;
        Ok(())
    }
}

/// Scenario: mint a new agent identity.
pub struct MintAgentScenario;

impl Scenario for MintAgentScenario {
    fn args(&self) -> Vec<CommandArg> {
        vec![CommandArg::new(
            "token_uri",
            "Off-chain metadata URI for the agent (e.g. 0g://<root>)",
            NamedCLType::String,
        )]
    }

    fn run(
        &self,
        env: &HostEnv,
        container: &DeployedContractsContainer,
        args: Args,
    ) -> Result<(), Error> {
        let mut contract = container.contract_ref::<AgentId>(env)?;
        let token_uri = args.get_single::<String>("token_uri")?;
        env.set_gas(100_000_000);
        let token_id = contract.mint_self(token_uri);
        println!("Minted agent id: {}", token_id);
        Ok(())
    }
}

impl ScenarioMetadata for MintAgentScenario {
    const NAME: &'static str = "mint_agent";
    const DESCRIPTION: &'static str = "Mints a new AgentId with the given token URI";
}

/// Main function to run the CLI tool.
pub fn main() {
    OdraCli::new()
        .about("CLI tool for Ligis Casper smart contracts")
        .deploy(LigisDeployScript)
        .contract::<AgentId>()
        .contract::<CredentialRegistry>()
        .scenario(MintAgentScenario)
        .build()
        .run();
}
