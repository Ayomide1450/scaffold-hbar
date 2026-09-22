# SaucerSwap Recurring Buy Template (Hedera)

Recurring buy / DCA scheduler on Hedera: **`RecurringBuy`** pre-funds a swap stream in HBAR, and any **keeper** can call `executeById` once a cadence elapses to swap a fixed HBAR amount into an HTS token through the **SaucerSwap V1 DEX**. A Next.js dashboard creates, monitors, and manages streams.

This is a **load-bearing DEX integration** — without SaucerSwap there is no price, no swap, no template. It composes three Hedera services:

| Hedera service | Where it is used |
| --- | --- |
| **HSCS** (Hedera Smart Contract Service) | `RecurringBuy` stores streams, es absorbs escrow, schedules cadences |
| **HTS** (Hedera Token Service) | Contract **self-associates** with the output token via the HTS precompile (`0x167`); purchased HTS tokens are accrued and withdrawn |
| **SaucerSwap V1 DEX** | `getAmountsOut` pricing + `swapExactETHForTokens` execution against the live AMM |

CLI key: `saucerswap-recurring-buy` (branch `templates/saucerswap-recurring-buy`).

```bash
npx create-scaffold-hbar@latest --template saucerswap-recurring-buy
```

General Scaffold-HBAR setup: [Scaffold HBAR on Hedera](https://docs.hedera.com/solutions/tools/scaffold-hbar/index). Step-by-step verification: [`RUNBOOK.md`](RUNBOOK.md).

## Disclaimer

This template—including **contracts, frontend, and tooling**—is **experimental** and **not audited**. Use testnets and small amounts only.

## How it works

1. **Create a stream** — the owner picks an HTS token, HBAR per cadence, cadence length, max slippage, and optionally a max cadence count. The contract pre-funds its HBAR escrow (`createStream` pays in `msg.value`). The output token must have a WHBAR pair on SaucerSwap V1 (e.g. SAUCE on testnet).
2. **Self-association** — `createStream` calls the HTS precompile `associateToken(address(this), tokenOut)` so the contract can *receive* the swap output (SaucerSwap reverts with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` otherwise). Response codes 22 (OK) / 23 (already associated) are both accepted.
3. **Execute (keeper-often)** — anyone calls `executeById(streamId)` once `nextExecutionAt` is reached. The contract quotes `getAmountsOut` on the live router, applies the stream's slippage tolerance, and calls `swapExactETHForTokens{value: buyAmountTinybar}`. Tokens accumulate on-chain.
4. **Owner controls** — pause / resume, top-up, withdraw accrued tokens, or close the stream and refund the remaining HBAR escrow.

Prices are never stored or hardcoded: the router is the single source of truth, and the swap cannot be sandwiched beyond the configured per-stream slippage tolerance (1–500 bps).

## Prerequisites

- [Node.js](https://nodejs.org/) — see [Node.js version](#nodejs-version) below (default: **20 LTS** ≥ 20.18.3)
- Yarn (default; required if you clone this repo) or npm if you scaffolded with the CLI. For Yarn, install via Corepack: `corepack enable && corepack prepare yarn@stable --activate`
- [Git](https://git-scm.com/)
- A funded **ECDSA** Hedera testnet account for contract deploy

## Node.js version

**Use Node 20 LTS (≥ 20.18.3) by default** for everything in this repo: `yarn install`, Hardhat (compile, test, deploy, verify), and the Next.js app. That matches what this template is tested against.

Example with fnm:

```bash
fnm use 20 && yarn install && yarn hardhat:test && yarn next:dev
```

## Quick start

1. Install dependencies:

```bash
yarn install
```

2. Copy environment files:

```bash
cp packages/nextjs/.env.example packages/nextjs/.env
```

3. Set `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` in `packages/nextjs/.env` (WalletConnect / HashPack / AppKit; a working demo id is used as fallback).

4. Deploy `RecurringBuy` to Hedera testnet:

```bash
yarn hardhat:account:generate   # or: yarn hardhat:account:import
yarn hardhat:deploy --network hederaTestnet
```

5. Run the app:

```bash
yarn next:dev        # http://localhost:3000
```

6. Connect **HashPack**, create a stream (testnet **SAUCE** `0.0.1183558` is pre-filled), fund it, then click **Execute (keeper)** once the cadence elapses.

Getting testnet HBAR: [Hedera Portal faucet](https://portal.hedera.com/faucet).

## Run the tests

`RecurringBuy` ships with hermetic unit tests — a **mock SaucerSwap router**, a **mock ERC-20**, and a **mock HTS precompile** (deployed at `0x167` and stubbed with `hardhat_setCode`). No forking and no funded account needed:

```bash
yarn hardhat:test
```

The suite covers stream creation, escrow funding and overflow refunds, cadence gating, swap execution + accrual, pausing, owner-only withdrawals, and close-with-refund.

## Deploy and verify `RecurringBuy`

Deployer account must be funded with testnet HBAR.

```bash
yarn hardhat:deploy --network hederaTestnet
yarn hardhat:verify:testnet
```

The deploy script reads the **SaucerSwap V1 router and WHBAR addresses** (testnet `0.0.19264` / `0.0.15058`, mainnet `0.0.3045981` / `0.0.1456986`) from `packages/hardhat/utils/saucerSwap.ts` and passes them to the constructor. `deployedContracts.ts` is regenerated with the deployed EVM address + native `hederaContractId` for HashPack.

Verified contracts appear on [Hashscan (testnet)](https://hashscan.io/testnet).

## Real testnet evidence

Everything below was executed on **Hedera testnet** and verified via the mirror node and `eth_call` — not simulated:

| Step | Transaction / reference | Result |
| --- | --- | --- |
| Deploy `RecurringBuy` → `0.0.10653896` (EVM `0x065FD5E0e1E20E3Bd523aFba3994073edfc95911`) | [0.0.7314364-1790024742-764317928](https://hashscan.io/testnet/tx/0.0.7314364-1790024742-764317928) | SUCCESS — constructor wired to SaucerSwap V1 router `0.0.19264` and WHBAR `0.0.15058` |
| `createStream` (SAUCE `0.0.1183558`) with 2 HBAR escrow | [0.0.7314364-1790025888-870973987](https://hashscan.io/testnet/tx/0.0.7314364-1790025888-870973987) | SUCCESS — `buyAmountTinybar = 1e8` (1 HBAR), cadence 60 s, slippage 300 bps, max cadences 2 |
| `executeById` stream #1 (keeper swap) | [0.0.7314364-1790025984-802398695](https://hashscan.io/testnet/tx/0.0.7314364-1790025984-802398695) | SUCCESS — logs show WHBAR deposit → SaucerSwap pair `Sync`/`Swap` → SAUCE to the contract → `CadenceExecuted` |
| Contract on [Hashscan](https://hashscan.io/testnet/contract/0.0.10653896) | balance 1 HBAR escrow + 54,960,360 SAUCE accrued | Live `eth_call`: `streamCount() = 1`, stream #1 has `executedCadences = 1`, `fundedTinybar = 1e8` (2 HBAR funded, 1 swapped) |

A reverted `createStream` is also on-chain and documented honestly: [0.0.7314364-1790025720-015814006](https://hashscan.io/testnet/tx/0.0.7314364-1790025720-015814006) passed `buyAmountTinybar = 1e18` (a wei-scale mistake) instead of `1e8` tinybars. It reverted with `InsufficientFunds` and is a useful caution: the contract EVM runs in **tinybar** (1e8 per HBAR) while the JSON-RPC tx `value` field runs in **wei** (1e18 per HBAR, divided by 1e10 by the relay).

## Environment variables

| Location | Key variables |
| --- | --- |
| `packages/nextjs/.env` | `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`, `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL`, `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL`, `HEDERA_RPC_URL` |
| `packages/hardhat/.env` | `HEDERA_RPC_URL`, `DEPLOYER_PRIVATE_KEY_ENCRYPTED` (set via `yarn hardhat:account:generate` / `import`) |

No server infrastructure is required — there is no facilitator, no MinIO, no Docker image to run.

## Useful commands

| Command | Purpose |
| --- | --- |
| `yarn hardhat:test` | Run `RecurringBuy` contract tests (hermetic, no fork) |
| `yarn hardhat:deploy --network hederaTestnet` | Deploy `RecurringBuy` |
| `yarn hardhat:verify:testnet` | Sourcify verify + HashScan link |
| `yarn hardhat:runner` | Execute due streams as a keeper (permissionless) |
| `yarn hardhat:chain` / `yarn hardhat:fork` | Local Hedera testnet / mainnet fork with live system contracts |
| `yarn next:dev` | Run the dashboard |

## Caveats

- **HashPack only** — the demo uses Reown AppKit with HashPack on the native **`hedera`** WalletConnect namespace. MetaMask and the dev burner wallet are not relevant.
- **Output tokens** — `tokenOut` must have a WHBAR/`tokenOut` pair on SaucerSwap V1. SAUCE on testnet is pre-filled; other tokens return a zero/`INSUFFICIENT_OUTPUT_AMOUNT` quote until a pair is created.
- **Cadence floor** — the contract enforces `MIN_CADENCE_SECONDS = 60` so a stream cannot grind the network with sub-minute swaps.
- **Keeper incentive** — execution is permissionless but does not pay the keeper; the design goal is a reliable public schedule, not MEV. Consider running your own keeper through a cron job or an HCS-gated runner if you build on top.
- **Testnet settlement** — swaps execute on Hedera **testnet** by default (mainnet if you deploy there and configure `hederaMainnet`).
- **No on-chain privacy** — stream amounts and accounts are visible on HashScan.
- **Node.js** — default **20 LTS** (≥ 20.18.3).

## Project layout

- **`packages/hardhat`** — `RecurringBuy` contract, mock contracts for tests, deploy script, SaucerSwap V1 address utils
- **`packages/nextjs`** — Next.js dashboard (create/manage streams, keeper execute, HashScan links)

## Links

- [SaucerSwap V1 docs — Swap HBAR for tokens](https://docs.saucerswap.finance/developers/v1/swap/swap-hbar-for-tokens)
- [Hedera Documentation](https://docs.hedera.com/)
- [Hashscan](https://hashscan.io/) — block explorer
- [Hedera Portal faucet](https://portal.hedera.com/faucet)
- [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar) — CLI