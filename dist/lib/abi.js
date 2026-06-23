export const PHAROS_AGENT_ID_ABI = [
    // ERC-721 metadata
    {
        type: "function",
        name: "name",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "string" }],
    },
    {
        type: "function",
        name: "symbol",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "string" }],
    },
    {
        type: "function",
        name: "tokenURI",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "string" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "ownerOf",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
    },
    // Agent ID-specific
    {
        type: "function",
        name: "walletOfAgent",
        stateMutability: "view",
        inputs: [{ name: "controller", type: "address" }],
        outputs: [{ name: "tokenId", type: "uint256" }],
    },
    {
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
    // State-changing
    {
        type: "function",
        name: "mint",
        stateMutability: "nonpayable",
        inputs: [
            { name: "controller", type: "address" },
            { name: "tokenURI", type: "string" },
        ],
        outputs: [{ name: "tokenId", type: "uint256" }],
    },
    {
        type: "function",
        name: "mintSelf",
        stateMutability: "nonpayable",
        inputs: [{ name: "tokenURI", type: "string" }],
        outputs: [{ name: "tokenId", type: "uint256" }],
    },
    {
        type: "function",
        name: "rotate",
        stateMutability: "nonpayable",
        inputs: [
            { name: "tokenId", type: "uint256" },
            { name: "newController", type: "address" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "revoke",
        stateMutability: "nonpayable",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [],
    },
    // Events
    {
        type: "event",
        name: "Transfer",
        inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
        ],
    },
    {
        type: "event",
        name: "AgentMinted",
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "controller", type: "address", indexed: true },
            { name: "tokenURI", type: "string", indexed: false },
        ],
    },
    {
        type: "event",
        name: "AgentRotated",
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
        ],
    },
    {
        type: "event",
        name: "AgentRevoked",
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "controller", type: "address", indexed: true },
        ],
    },
    {
        type: "event",
        name: "MetadataUpdated",
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "newTokenURI", type: "string", indexed: false },
        ],
    },
];
export const CREDENTIAL_REGISTRY_ABI = [
    {
        type: "function",
        name: "isCapable",
        stateMutability: "view",
        inputs: [
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
        ],
        outputs: [{ name: "capable", type: "bool" }],
    },
    {
        type: "function",
        name: "isCapableFromIssuer",
        stateMutability: "view",
        inputs: [
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
            { name: "issuer", type: "address" },
        ],
        outputs: [{ name: "capable", type: "bool" }],
    },
    {
        type: "function",
        name: "latestCredential",
        stateMutability: "view",
        inputs: [
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
        ],
        outputs: [
            {
                name: "view",
                type: "tuple",
                components: [
                    { name: "issuer", type: "address" },
                    { name: "issuedAt", type: "uint64" },
                    { name: "expiresAt", type: "uint64" },
                    { name: "revoked", type: "bool" },
                    { name: "valid", type: "bool" },
                ],
            },
        ],
    },
    {
        type: "function",
        name: "getCredential",
        stateMutability: "view",
        inputs: [
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "issuer", type: "address" },
                    { name: "issuedAt", type: "uint64" },
                    { name: "expiresAt", type: "uint64" },
                    { name: "revoked", type: "bool" },
                    { name: "valid", type: "bool" },
                ],
            },
        ],
    },
    {
        type: "function",
        name: "issuerNonce",
        stateMutability: "view",
        inputs: [{ name: "issuer", type: "address" }],
        outputs: [{ name: "nonce", type: "uint256" }],
    },
    {
        type: "function",
        name: "hashTypedData",
        stateMutability: "view",
        inputs: [
            { name: "issuer", type: "address" },
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
            { name: "issuedAt", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "nonce", type: "uint256" },
        ],
        outputs: [{ name: "digest", type: "bytes32" }],
    },
    {
        type: "function",
        name: "DOMAIN_SEPARATOR",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "ds", type: "bytes32" }],
    },
    {
        type: "function",
        name: "issue",
        stateMutability: "nonpayable",
        inputs: [
            { name: "issuer", type: "address" },
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
            { name: "issuedAt", type: "uint64" },
            { name: "expiresAt", type: "uint64" },
            { name: "nonce", type: "uint256" },
            { name: "signature", type: "bytes" },
        ],
        outputs: [{ name: "credentialIndex", type: "uint256" }],
    },
    {
        type: "function",
        name: "revoke",
        stateMutability: "nonpayable",
        inputs: [
            { name: "subject", type: "address" },
            { name: "capabilityHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "event",
        name: "CredentialIssued",
        inputs: [
            { name: "issuer", type: "address", indexed: true },
            { name: "subject", type: "address", indexed: true },
            { name: "capabilityHash", type: "bytes32", indexed: true },
            { name: "issuedAt", type: "uint64", indexed: false },
            { name: "expiresAt", type: "uint64", indexed: false },
            { name: "nonce", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "CredentialRevoked",
        inputs: [
            { name: "issuer", type: "address", indexed: true },
            { name: "subject", type: "address", indexed: true },
            { name: "capabilityHash", type: "bytes32", indexed: true },
            { name: "nonce", type: "uint256", indexed: false },
            { name: "revokedAt", type: "uint64", indexed: false },
        ],
    },
];
//# sourceMappingURL=abi.js.map