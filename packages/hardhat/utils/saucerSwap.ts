// SaucerSwap V1 deployments on Hedera (canonical addresses from
// https://docs.saucerswap.finance/developers/contracts, verified against the testnet Mirror Node).
// EVM addresses are the mirror-node `evm_address` (long-zero form) of each Hedera entity id.

export interface SaucerSwapV1Deployment {
  chainId: number;
  /** Name used in docs / HashScan links. */
  network: "testnet" | "mainnet";
  /** SaucerSwapV1RouterV3 Hedera id. */
  routerId: string;
  /** Router EVM address (long-zero). */
  routerEvmAddress: string;
  /** SaucerSwapV1Factory Hedera id. */
  factoryId: string;
  /** Factory EVM address (long-zero). */
  factoryEvmAddress: string;
  /** WHBAR HTS token (path[0]) Hedera id. */
  whbarId: string;
  /** WHBAR HTS token EVM address (long-zero). */
  whbarEvmAddress: string;
  /** WHBAR "Wrapped Hbar" contract (wrapper) Hedera id. */
  whbarContractId: string;
}

export const SAUCERSWAP_V1: Record<number, SaucerSwapV1Deployment> = {
  296: {
    chainId: 296,
    network: "testnet",
    routerId: "0.0.19264",
    routerEvmAddress: "0x0000000000000000000000000000000000004b40",
    factoryId: "0.0.9959",
    factoryEvmAddress: "0x00000000000000000000000000000000000026e7",
    whbarId: "0.0.15058",
    whbarEvmAddress: "0x0000000000000000000000000000000000003ad2",
    whbarContractId: "0.0.15057",
  },
  295: {
    chainId: 295,
    network: "mainnet",
    routerId: "0.0.3045981",
    routerEvmAddress: "0x00000000000000000000000000000000002e7a5d",
    factoryId: "0.0.1062784",
    factoryEvmAddress: "0x0000000000000000000000000000000000103780",
    whbarId: "0.0.1456986",
    whbarEvmAddress: "0x0000000000000000000000000000000000163b5a",
    whbarContractId: "0.0.1456985",
  },
};

export function getSaucerSwapV1(chainId: number): SaucerSwapV1Deployment {
  const deployment = SAUCERSWAP_V1[chainId];
  if (!deployment) {
    throw new Error(`No SaucerSwap V1 deployment configured for chain id ${chainId}.`);
  }
  return deployment;
}

/** Helper so typechain doesn't need the router's full ABI on-chain. */
export function toEthereumAddress(hederaId: string): string {
  const parts = hederaId.split(".").map(Number);
  const num = parts[2];
  if (num > 0xffffffff) {
    // Account/token ids beyond 4 bytes require the extended long-zero form.
    throw new Error(`Cannot map hed id ${hederaId} to a 20-byte EVM address.`);
  }
  return `0x${num.toString(16).padStart(40, "0")}`;
}
