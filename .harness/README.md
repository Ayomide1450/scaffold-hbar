# RecurringBuy harness

Automated verification of the SaucerSwap recurring-buy template. Runs everything hermetically — no funded testnet account, no fork, no Docker.

## 0. One-shot (passed)

```bash
yarn install
yarn hardhat:compile
yarn hardhat:test
```

Expected:

- `Compiled N Solidity files successfully` (RecurringBuy + 3 mocks).
- **8 passing** tests (see `packages/hardhat/test/RecurringBuy.test.ts`).

## 1. Deploy the local fork with live system contracts (optional)

Needs a funded testnet account only when hitting the real network. For a fully local loop:

```bash
yarn hardhat:chain    # Hedera testnet fork (live HTS precompile at 0x167)
# in another shell:
yarn hardhat:deploy --network localhost   # deploys onto the running fork
```

## 2. Live testnet proof

1. Fund an ECDSA testnet account via [Hedera Portal faucet](https://portal.hedera.com/faucet).
2. `yarn hardhat:account:generate` (or import) → `yarn hardhat:deploy --network hederaTestnet`.
3. `yarn hardhat:verify:testnet` → copy the HashScan link.
4. Create a SAUCE stream in the dashboard (`packages/nextjs`), wait one cadence, then `yarn hardhat:runner` executes it. Capture the `CadenceExecuted` tx hash → HashScan.

Evidence captured to the harness report: deploy tx, verify link, at least one executed-cadence tx hash, and the on-chain `RecurringBuy` address + `hederaContractId` written into `packages/nextjs/contracts/deployedContracts.ts`.

## 3. Harvest

- `yarn next:dev` → dashboard shows the funded stream, cadence count, accrued SAUCE, HashScan links per tx.
- Clean run: `yarn lint && yarn next:build` (Node ≥ 20.18.3).