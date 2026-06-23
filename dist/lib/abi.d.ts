export declare const PHAROS_AGENT_ID_ABI: readonly [{
    readonly type: "function";
    readonly name: "name";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}, {
    readonly type: "function";
    readonly name: "symbol";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}, {
    readonly type: "function";
    readonly name: "tokenURI";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}, {
    readonly type: "function";
    readonly name: "balanceOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "ownerOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly type: "function";
    readonly name: "walletOfAgent";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "controller";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "totalSupply";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "mint";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "controller";
        readonly type: "address";
    }, {
        readonly name: "tokenURI";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "mintSelf";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenURI";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "rotate";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "newController";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "revoke";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "setTokenURI";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "newURI";
        readonly type: "string";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "exists";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly type: "event";
    readonly name: "Transfer";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "AgentMinted";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "controller";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenURI";
        readonly type: "string";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "AgentRotated";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "AgentRevoked";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "controller";
        readonly type: "address";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "MetadataUpdated";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "newTokenURI";
        readonly type: "string";
        readonly indexed: false;
    }];
}];
export declare const CREDENTIAL_REGISTRY_ABI: readonly [{
    readonly type: "function";
    readonly name: "isCapable";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "capable";
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "isCapableFromIssuer";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }, {
        readonly name: "issuer";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "capable";
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "latestCredential";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "view";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "issuer";
            readonly type: "address";
        }, {
            readonly name: "issuedAt";
            readonly type: "uint64";
        }, {
            readonly name: "expiresAt";
            readonly type: "uint64";
        }, {
            readonly name: "revoked";
            readonly type: "bool";
        }, {
            readonly name: "valid";
            readonly type: "bool";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "getCredential";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "issuer";
            readonly type: "address";
        }, {
            readonly name: "issuedAt";
            readonly type: "uint64";
        }, {
            readonly name: "expiresAt";
            readonly type: "uint64";
        }, {
            readonly name: "revoked";
            readonly type: "bool";
        }, {
            readonly name: "valid";
            readonly type: "bool";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "issuerNonce";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "issuer";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "nonce";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "hashTypedData";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "issuer";
        readonly type: "address";
    }, {
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }, {
        readonly name: "issuedAt";
        readonly type: "uint256";
    }, {
        readonly name: "expiresAt";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "digest";
        readonly type: "bytes32";
    }];
}, {
    readonly type: "function";
    readonly name: "DOMAIN_SEPARATOR";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "ds";
        readonly type: "bytes32";
    }];
}, {
    readonly type: "function";
    readonly name: "issue";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "issuer";
        readonly type: "address";
    }, {
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }, {
        readonly name: "issuedAt";
        readonly type: "uint64";
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [{
        readonly name: "credentialIndex";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "revoke";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "subject";
        readonly type: "address";
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "event";
    readonly name: "CredentialIssued";
    readonly inputs: readonly [{
        readonly name: "issuer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "subject";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "issuedAt";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "CredentialRevoked";
    readonly inputs: readonly [{
        readonly name: "issuer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "subject";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "capabilityHash";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "revokedAt";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}];
