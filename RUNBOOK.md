# SaucerSwap Recurring-Buy Template — Runbook

Step-by-step verification of the **SaucerSwap recurring-buy (DCA)** template. Run commands from the repository root unless stated otherwise.

> Status: iteration coverage below. See **Environment variables** and **Testnet caveats** for configuration reference.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | ≥ 20.18.3 (default) | Hardhat, Next.js, scripts |
| Yarn | 3.2.3 (via corepack) | monorepo scripts |
| A funded **ECDSA** Hedera testnet account | — | deploying `RecurringBuy` and running a keeper |

Get a testnet account and HBAR from the [Hedera Portal](https://portal.hedera.com/) faucet. Create the account as **ECDSA** so HashPack and the agent keeper can sign.

---

## Iteration 1 — Smart contract (`RecurringBuy`)

`RecurringBuy` uses the HTS precompile for token association, but its unit tests run **hermetic** against mock contracts — no fork, no funded account.

### 1.1 Compile

```bash
yarn hardhat:compile
```

Expected: `Compiled 1 Solidity file successfully` and TypeChain typings generated.

### 1.2 Run the unit tests

```bash
yarn hardhat:test
```

Expected: **8 passing** — stream creation, escrow funding + overflow refund, cadence gating, swap execution + token accrual, pause/resume, owner-only withdraw, close-with-refund. A gas report prints at the end. The mock suite in `packages/hardhat/contracts/mocks/` stubs the SaucerSwap router and the HTS precompile (`0x167` via `hardhat_setCode`) so no fork is required.

### 1.3 Deploy to Hedera testnet

This regenerates `packages/nextjs/contracts/deployedContracts.ts` with the live EVM address and native Hedera contract id.

```bash
# One-time: create or import a funded deployer key
yarn hardhat:account:generate        # or: yarn hardhat:account:import
# Fund the printed account with testnet HBAR, then:
yarn hardhat:deploy --network hederaTestnet
```

Expected:
- `deploying "RecurringBuy" ... deployed at 0x...`
- `Resolved Hedera contract id: 0.0.xxxxx`
- `📝 Updated TypeScript contract definition file on ../nextjs/contracts/deployedContracts.ts`
- A `296: { RecurringBuy: { address, hederaContractId, abi, ... } }` entry exists in `deployedContracts.ts`.
- View it on HashScan: `https://hashscan.io/testnet/contract/0x...`

The deploy passes the SaucerSwap V1 router + WHBAR EVM addresses from `packages/hardhat/utils/saucerSwap.ts` (testnet `0.0.19264` / `0.0.15058`).

---

## Iteration 2 — Mirror node address checks

SaucerSwap references (persisted tokens/accounts) can be cross-checked against the mirror node:

```bash
# SaucerSwap V1 RouterV3 (testnet)
curl -s https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.19264 | ConvertFrom-Json | select evm_address, contract_id
# WHBAR token (testnet) — check tokens/0.0.15058 has a supply and decimals 8

# RecurringBuy deployed id → EVM address equivalence
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/$HEDERA_CONTRACT_ID" | select evm_address
```

---

## Iteration 3 — Live swap on testnet (agent keeper)

The **keeper runner** (`scripts/runner.ts`) polls the chain for a due stream (any owner's) and executes it. On testnet this is how DCA actually happens: owner creates + funds a stream, then the runner executes each cadence.

### 3.1 Prerequisites

1. `RecurringBuy` deployed and `deployedContracts.ts` populated with `address` + `hederaContractId` (Iteration 1.3).
2. `packages/hardhat/.env` configured (deployer/governance key). A keeper does not need its own funded key for *reading*; executing is permissionless — any funded ECDSA key works.
3. A **SAUCE/WHBAR stream**: open the dashboard at `http://localhost:3000`, connect HashPack, and `Create stream` with token `0.0.1183558` (testnet SAUCE), cadence `60s`, slippage `300 bps`, funded with ≥ 2 HBAR.

### 3.2 Run the keeper

```bash
yarn hardhat:runner --network hederaTestnet   # polls every 15s, executes due streams
```

Expected per due stream:
- `quote: in=... tinybar, out=... (slot0)` from the mock/router `getAmountsOut`
- `executing stream #0 · swap 100000000 tinybar → SAUCE`
- `✅ executed, tokens accrued ... , gasUsed=...`
- Optionally a mirrored `hcs` audit message id published to the stream's HCS topic.

Verify the swap on HashScan:
- **HBAR out / SAUCE in** — open the `RecurringBuy` contract page and check the last `Swap`-like transfer; the contract's SAUCE balance must have increased by the swap output minus any immediate withdraw.

### 3.3 Owner operations (dashboard)

- **Pause** — blocks `executeById` for that stream (`StreamPaused` revert) until **Resume**.
- **Withdraw** — owner pulls accrued SAUCE; `accruedOf` decreases by the withdrawn amount.
- **Close** — owner closes the stream; remaining escrow HBAR is refunded (contract balance drops to `0` for refunded stream + prior payments).

Sanity checks:
- Executing a stream that is not due → `CadenceNotReached`.
- Executing after final cadence (maxCadences reached) → `StreamExhausted`.
- Keeper execute with insufficient escrow before the terminate window → `EscrowEmpty`.
- Non-owner pause/withdraw/close → `NotOwner`.

---

## Iteration 4 — Client + UI

End-to-end: connect HashPack, create + fund a stream, watch it execute, withdraw SAUCE.

### Prerequisites

- Iterations 1–2 complete (contract deployed, `deployedContracts.ts` populated).
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` set in `packages/nextjs/.env`.
- HashPack mobile/extension on Hedera testnet, funded with testnet HBAR.

### A — Create and fund a stream (browser)

1. Connect **HashPack** in the header.
2. On the dashboard, set token **SAUCE (testnet HTS)**, cadence `60s`, slippage `300 bps`, max cadences (e.g. `3`), and fund with ≥ 2 HBAR.
3. Submit — HashPack prompts to sign the native `createStream` contract execute. After confirm, the stream card appears with `nextExecutionAt` ~60 s out.

### B — Execute the cadence (browser)

1. Once `nextExecutionAt` passes, click **Execute (keeper)** on the stream card.
2. HashPack signs the `executeById` call; the card updates `executedCadences`, accrued SAUCE, and links to the HashScan tx.

### C — Withdraw / close (browser)

1. **Withdraw** moves accrued SAUCE to your wallet (your account must be associated with SAUCE — HashPack prompts/auto-associates).
2. **Close** refunds remaining escrow HBAR and marks the stream closed.

---

## Environment variables

Two `.env` files configure the monorepo. Copy each from its `.env.example` before running.

### `packages/nextjs/.env`

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | WalletConnect project id (HashPack via Reown AppKit) |
| `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` / `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | Public config RPC endpoints |
| `HEDERA_RPC_URL` | RPC for on-chain read/write from the app server |

### `packages/hardhat/.env`

| Variable | Purpose |
| --- | --- |
| `HEDERA_RPC_URL` | JSON-RPC endpoint (testnet default) |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | Set via `yarn hardhat:account:generate` / `import` — never edit by hand |

---

## Testnet caveats

- **No local infra required** — there is no MinIO/facilitator/Docker in this template. Everything runs on testnet directly.
- **ECDSa accounts only** — HashPack and the keeper sign contract executes with ECDSA testnet keys.
- **Token pairs** — `tokenOut` must have a WHBAR pair on SaucerSwap V1 **in the network you deploy on**. SAUCE (testnet) has one; a new HTS token needs its pair bootstrapped or the quote is `0`.
- **Slippage band** — the contract enforces `1–500 bps` (`maxSlippageBps`). Mainnet HTS pairs can be thin; keep slippage ≥ 200 bps.
- **Keeper economics** — `executeById` is permissionless and free (no keeper bounty). A public scheduler (e.g. cron/HCS-triggered runner) is the operational model.
- **Node.js** — Node 20 LTS by default; optional Node 22 for `yarn next:dev` / `yarn next:build` only (see [README § Node.js version](README.md#nodejs-version)).
- **No on-chain privacy** — swap amounts and accounts are public on Hedera.

---

## Iteration 5 — Packaging (`create-scaffold-hbar`)

This template publishes as git branch **`templates/saucerswap-recurring-buy`** on the scaffold-hbar repo. The CLI downloads that branch via giget — no embedded copy in the CLI repo.

### 5.1 What ships in the template

| Piece | Location |
| --- | --- |
| Manifest (consumed then deleted by CLI) | `template.json` |
| Contracts (Hardhat only) | `packages/hardhat/contracts/` (`RecurringBuy.sol`, mocks) |
| Deploy + verify + keeper runner | `packages/hardhat/scripts/`, `deploy/` |
| Dashboard | `packages/nextjs/` |
| Docs | `README.md`, `RUNBOOK.md`, `AGENTS.md` |

Foundry is **not** included. `template.json` locks `solidityFramework` to `hardhat` only.

### 5.2 Publish / update the template branch

From a branch that contains the finished template, using the **user-owned** fork (`Ayomide1450/scaffold-hbar`):

```bash
git push origin HEAD:templates/saucerswap-recurring-buy
```

The branch name must be exactly `templates/saucerswap-recurring-buy` so
`npx create-scaffold-hbar@latest --template Ayomide1450/scaffold-hbar` resolves to the fork's branch.

### 5.3 Scaffold a fresh project

```bash
npx create-scaffold-hbar@latest --template Ayomide1450/scaffold-hbar
```

Interactive mode lists the template once the branch exists on GitHub (GitHub API `templates/*` refs). The CLI prints custom **outro steps** from `template.json` (env copy, Hardhat deploy, `yarn next:dev`).

### 5.4 Post-scaffold smoke test

After scaffolding into a clean directory:

1. `yarn install`
2. Copy `packages/nextjs/.env.example` → `packages/nextjs/.env` and set WalletConnect + RPC creds.
3. `yarn hardhat:test` # hermetic — no fork needed.
4. `yarn hardhat:deploy --network hederaTestnet`
5. `yarn next:dev` → create a SAUCE stream in the browser, then run `yarn hardhat:runner --network hederaTestnet` to execute it.