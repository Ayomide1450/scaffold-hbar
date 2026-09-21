import * as path from "path";

import hre from "hardhat";

/**
 * Keeper runner for RecurringBuy streams.
 *
 * Polls the chain for any stream whose `nextExecutionAt` has elapsed and executes
 * it (permissionless — anyone may execute, no keeper bounty). Run against a live
 * network:
 *
 *   yarn hardhat:runner --network hederaTestnet   # or --network hederaMainnet
 *
 * The keeper signs with the network-configured account (see hardhat.config.ts).
 * Keeper runs against the in-process "hardhat" network make no sense — pick the
 * network the contract is deployed on.
 */
const POLL_INTERVAL_SECONDS = Number(process.env.KEEPER_POLL_SECONDS ?? 15);
const STOP_AFTER = process.env.KEEPER_MAX_ITERATIONS ? Number(process.env.KEEPER_MAX_ITERATIONS) : undefined;

async function main() {
  const networkName = hre.network.name;

  if (networkName === "hardhat" || networkName === "localhost") {
    throw new Error(
      `Refusing to keep streams on the "${networkName}" network. Run with --network hederaTestnet (or hederaMainnet), the network the contract is deployed on.`,
    );
  }

  const deploymentPath = path.join(hre.config.paths.deployments, networkName, "RecurringBuy.json");

  let deployment: { address: string; hederaContractId?: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    deployment = require(deploymentPath) as { address: string; hederaContractId?: string };
  } catch {
    throw new Error(
      `No RecurringBuy deployment on "${networkName}". Run \`yarn hardhat:deploy --network ${networkName}\` first.`,
    );
  }

  const [signer] = await hre.ethers.getSigners();
  const contract = await hre.ethers.getContractAt("RecurringBuy", deployment.address, signer);

  console.log(`Keeper ready · network=${networkName} contract=${deployment.address}`);
  if (deployment.hederaContractId) {
    console.log(`HashScan: https://hashscan.io/${networkName === "hederaTestnet" ? "testnet" : "mainnet"}/contract/${deployment.hederaContractId}`);
  }
  console.log(`Signer: ${await signer.getAddress()}\n`);

  const executed: number[] = [];

  async function sweepOnce(iteration: number): Promise<void> {
    let streamCount = 0;
    try {
      streamCount = Number(await contract.streamCount());
    } catch (error) {
      console.log(`  (skip) contract read failed: ${(error as Error).message}`);
      return;
    }

    for (let streamId = 1; streamId <= streamCount; streamId++) {
      const stream = await contract.getStream(streamId);
      const now = Math.floor(Date.now() / 1000);

      if (stream.isPaused || now < Number(stream.nextExecutionAt)) {
        continue;
      }

      const annotated = `${stream.owner.slice(0, 6)}…${stream.owner.slice(-4)} → ${stream.tokenOut}`;
      console.log(`[sweep #${iteration}] executing stream #${streamId} · ${annotated}`);
      console.log(`  buyAmountTinybar=${stream.buyAmountTinybar} cadence=${stream.cadenceSeconds}s slippage=${stream.maxSlippageBps}bps`);

      try {
        const tx = await contract.executeById(streamId);
        const receipt = await tx.wait();
        const amountOut = await contract.accruedOf(streamId, stream.tokenOut);
        console.log(`  ✅ executed · tx=${receipt.hash} gasUsed=${receipt.gasUsed} accrued=${amountOut}`);
        executed.push(streamId);
      } catch (error) {
        console.log(`  ❌ execute failed: ${(error as Error).message}`);
      }
    }
  }

  let iteration = 0;
  for (;;) {
    iteration++;
    await sweepOnce(iteration);

    if (STOP_AFTER !== undefined && iteration >= STOP_AFTER) {
      break;
    }

    console.log(`  — sleeping ${POLL_INTERVAL_SECONDS}s (pid ${process.pid})`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000));
  }

  console.log(`\nRan ${iteration} sweeps; executed stream(s): ${executed.length > 0 ? executed.join(", ") : "none (nothing due)"}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});