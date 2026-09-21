# SaucerSwap Recurring-Buy Agent Guide

Guidance for coding agents working in the **SaucerSwap recurring-buy (DCA)** Scaffold-HBAR template.

## What this template does

A `RecurringBuy` contract on Hedera runs dollar-cost-averaging: owners pre-fund a stream in native **HBAR**, and any **keeper** can call `executeById` after each cadence to swap a fixed HBAR amount into an HTS token through the **SaucerSwap V1 DEX**. Purchases accumulate on the contract; the owner withdraws them (`withdraw`) or closes the stream and refunds escrow (`closeStream`).

The SaucerSwap router is the **single source of truth for pricing** — nothing is stored or hardcoded. Removing the DEX integration makes the template unable to buy.

## Repo layout

- **`packages/hardhat`** — `RecurringBuy.sol`, deploy scripts, tests, SaucerSwap address utils
- **`packages/nextjs`** — Next.js dashboard (create/manage streams, keeper execute, HashScan links)

## Hedera services in play

- **HSCS** — smart contract state (streams, escrow, cadences).
- **HTS** — the contract **self-associates** with the output token in `createStream` via the HTS precompile:
  - `associateToken(address(this), tokenOut)` at `HTS_PRECOMPILE_ADDRESS = 0x…0167`
  - accepted response codes: `HAPI_OK = 22` and `HAPI_ALREADY_ASSOCIATED = 23`
- **SaucerSwap V1** — `getAmountsOut` quote + `swapExactETHForTokens{value: buyAmountTinybar}` with `path = [whbar, tokenOut]`, `to = address(this)`, `deadline`.

## Key facts

- **Naming** — the SaucerSwap V1 router keeps Uniswap's `swapExactETHForTokens` name (HBAR is the "ETH"). There is **no** `swapExactHbarForTokens`.
- **WHBAR in path** — `path[0]` must be the **WHBAR token id** (0.0.15058 testnet / 0.0.1456986 mainnet), not the WHBAR wrapper contract.
- **Association** — the swap recipient (`address(this)`) must be associated with the output token or SaucerSwap reverts `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. `createStream` handles this.
- **Units** — HBAR amounts are **tinybar-scale in the contract EVM**: 1 HBAR = 1e8 tinybars, and `msg.value`/balances/`buyAmountTinybar`/swap `value` are all observed at that scale. The JSON-RPC tx `value` field is EVM wei (1e18 per HBAR) — the relay divides it by **1e10** before execution. So for a payment of X HBAR: tx `value` = X × 1e18 wei, contract sees msg.value = X × 1e8 tinybar, and `buyAmountTinybar` passed to `createStream` must be X × 1e8. Verified on testnet (`InsufficientFunds` decoded with msg.value=2e8 for a 2-HBAR tx; the successful stream funded 2e8 tinybar escrow with a 2e18-wei tx value).
- **Slippage** — per-stream `maxSlippageBps` (1–500), applied to the live `getAmountsOut` quote as `amountOutMin`.
- **Cadence floor** — `MIN_CADENCE_SECONDS = 60`.
- **Do not forbid Docker** — this template needs none; there is no local infra.

## Contract API

| Function | Caller | Purpose |
| --- | --- | --- |
| `createStream(tokenOut, buyAmountTinybar, cadenceSeconds, maxSlippageBps, maxCadences)` | anyone (payable) | open + fund a stream |
| `executeById(streamId)` | anyone | swap next due cadence |
| `pauseStream` / `resumeStream` | owner | stop/start keeper execution |
| `topUpStream` (payable) | owner | add escrow |
| `withdraw(streamId, tokenOut)` | owner | take accrued tokens |
| `closeStream(streamId)` | owner | refund remaining escrow |
| `getStream(streamId)`, `accruedOf`, `streamCount`, `router`, `whbar` | anyone | reads |

## Tests

Hermetic unit tests in `packages/hardhat/test/RecurringBuy.test.ts` use mocks — no forking:

- `MockSaucerSwapRouter` — 5% fee AMM double; mints the output token to the swap recipient.
- `MockERC20` — SAUCE stand-in.
- `MockHederaTokenService` — its bytecode is stubbed at `0x167` via `hardhat_setCode` so `associateToken` returns 22.

Run: `yarn hardhat:test`.

## Rules

- **Tinybars only** — never floats for HBAR amounts; convert with the 1e8 / 1e18 helpers in the UI or tests.
- **Never hardcode prices** — any price used for `amountOutMin` must come from the router's `getAmountsOut`, not from a static number.
- **Constructor args** — deploy passes `[routerEvmAddress, whbarEvmAddress]` from `utils/saucerSwap.ts`; update that file (not the deploy script) when a network changes.
- **Preserve `hederaContractId`** — the deploy script augments the deployment JSON with the native contract id, required for HashPack contract executes. Don't strip it.

## Local workflow

- `yarn hardhat:chain` — Hedera testnet fork (live system contracts); `yarn hardhat:fork` — mainnet fork.
- `yarn hardhat:test` — hermetic tests (no fork).
- `yarn hardhat:deploy --network hederaTestnet` — deploy + regenerate `deployedContracts.ts`.
- `yarn next:dev` — dashboard.

## References

- SaucerSwap V1 swap docs: https://docs.saucerswap.finance/developers/v1/swap/swap-hbar-for-tokens
- SaucerSwap periphery (ABI source): https://github.com/saucerswaplabs/saucerswap-periphery
- Mirror node (address verification): https://testnet.mirrornode.hedera.com

Use skill: **`saucerswap-v1`** patterns via the above docs when wiring DEX calls; keep the fallback `getAmountsOut` → `amountOutMin` slippage path.