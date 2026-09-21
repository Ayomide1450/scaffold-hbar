/**
 * This file contains external contract definitions (contracts not deployed by this project).
 * Add entries here to interact with pre-deployed contracts on any supported chain.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

/**
 * SaucerSwap V1 RouterV3 — canonical deployment whose swap/liquidity functions
 * `RecurringBuy` executes against. See packages/hardhat/utils/saucerSwap.ts for
 * the full address map (testnet 0.0.19264 / mainnet 0.0.3045981).
 */
const externalContracts = {
  296: {
    SaucerSwapV1Router: {
      address: "0x0000000000000000000000000000000000004b40",
      hederaContractId: "0.0.19264",
      abi: [
        {
          inputs: [
            {
              internalType: "uint256",
              name: "amountOutMin",
              type: "uint256",
            },
            {
              internalType: "address[]",
              name: "path",
              type: "address[]",
            },
            {
              internalType: "address",
              name: "to",
              type: "address",
            },
            {
              internalType: "uint256",
              name: "deadline",
              type: "uint256",
            },
          ],
          name: "swapExactETHForTokens",
          outputs: [
            {
              internalType: "uint256[]",
              name: "amounts",
              type: "uint256[]",
            },
          ],
          stateMutability: "payable",
          type: "function",
        },
        {
          inputs: [
            {
              internalType: "uint256",
              name: "amountIn",
              type: "uint256",
            },
            {
              internalType: "address[]",
              name: "path",
              type: "address[]",
            },
          ],
          name: "getAmountsOut",
          outputs: [
            {
              internalType: "uint256[]",
              name: "amounts",
              type: "uint256[]",
            },
          ],
          stateMutability: "view",
          type: "function",
        },
      ],
    },
  },
  295: {
    SaucerSwapV1Router: {
      address: "0x00000000000000000000000000000000002e7a5d",
      hederaContractId: "0.0.3045981",
      abi: [
        {
          inputs: [
            {
              internalType: "uint256",
              name: "amountOutMin",
              type: "uint256",
            },
            {
              internalType: "address[]",
              name: "path",
              type: "address[]",
            },
            {
              internalType: "address",
              name: "to",
              type: "address",
            },
            {
              internalType: "uint256",
              name: "deadline",
              type: "uint256",
            },
          ],
          name: "swapExactETHForTokens",
          outputs: [
            {
              internalType: "uint256[]",
              name: "amounts",
              type: "uint256[]",
            },
          ],
          stateMutability: "payable",
          type: "function",
        },
        {
          inputs: [
            {
              internalType: "uint256",
              name: "amountIn",
              type: "uint256",
            },
            {
              internalType: "address[]",
              name: "path",
              type: "address[]",
            },
          ],
          name: "getAmountsOut",
          outputs: [
            {
              internalType: "uint256[]",
              name: "amounts",
              type: "uint256[]",
            },
          ],
          stateMutability: "view",
          type: "function",
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;