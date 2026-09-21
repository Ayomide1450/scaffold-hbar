import * as fs from "fs";
import * as path from "path";

import hre from "hardhat";

/**
 * Verify contracts deployed with hardhat-deploy on the active network.
 *
 * Sourcify's legacy v1 `/server/verify` API was shut down in July 2026, so the
 * `@nomicfoundation/hardhat-verify` Sourcify driver no longer works. This script
 * calls the Sourcify **v2** API directly using the compiled `metadata.json` from the
 * deployment artifact (the same payload Sourcify's own UI submits), then polls the
 * verification job until it completes and prints the match status + HashScan link.
 *
 * Sourcify v2 reference:
 *   https://sourcify.dev/server/api-docs/#/Verify%20Contracts/post_v2_verify_metadata__chainId___address_
 */
const SOURCIFY_SERVER = "https://sourcify.dev/server";

interface SourcifyJob {
  isJobCompleted: boolean;
  contract?: { match: string | null; address: string; chainId: string };
  error?: { message: string };
}

async function submitWithMetadata(chainId: number, address: string, metadata: unknown, sources: Record<string, string>, creationTransactionHash?: string) {
  const body = JSON.stringify({ metadata, sources, creationTransactionHash });
  const res = await fetch(`${SOURCIFY_SERVER}/v2/verify/metadata/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (res.status !== 202) {
    throw new Error(`Sourcify returned ${res.status}: ${await res.text()}`);
  }
  const { verificationId } = (await res.json()) as { verificationId: string };
  return verificationId;
}

async function pollJob(verificationId: string, attempts = 12, delayMs = 3_000): Promise<SourcifyJob> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(`${SOURCIFY_SERVER}/v2/verify/${verificationId}`);
    const job = (await res.json()) as SourcifyJob;
    if (job.isJobCompleted) {
      return job;
    }
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Timed out waiting for Sourcify verification job ${verificationId}.`);
}

async function main() {
  const all = await hre.deployments.all();
  const names = Object.keys(all).sort();

  if (names.length === 0) {
    throw new Error(
      `No deployments found for "${hre.network.name}". Run \`yarn hardhat:deploy --network ${hre.network.name}\` first.`,
    );
  }

  const chainId = Number(hre.network.config.chainId);
  const networkLabel = chainId === 295 ? "mainnet" : chainId === 296 ? "testnet" : "unknown";
  let verified = 0;

  for (const name of names) {
    const deploymentPath = path.join(hre.config.paths.deployments, hre.network.name, `${name}.json`);
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as {
      address?: string;
      metadata?: string;
      receipt?: { transactionHash?: string };
    };

    if (!deployment.address || !deployment.metadata) {
      console.log(`Skipping ${name} — no address/metadata in deployment record.`);
      continue;
    }

    const metadata = JSON.parse(deployment.metadata) as {
      sources?: Record<string, { content?: string }>;
    };
    const sources: Record<string, string> = {};
    for (const [sourcePath, source] of Object.entries(metadata.sources ?? {})) {
      if (source.content) {
        sources[sourcePath] = source.content;
      }
    }

    if (Object.keys(sources).length === 0) {
      console.log(`Skipping ${name} — no source content embedded in metadata.`);
      continue;
    }

    console.log(`\nVerifying ${name} at ${deployment.address} (chain ${chainId})...`);
    const verificationId = await submitWithMetadata(chainId, deployment.address, metadata, sources, deployment.receipt?.transactionHash);
    const job = await pollJob(verificationId);

    if (job.contract?.match) {
      console.log(`✅ ${name}: Sourcify ${job.contract.match} at ${deployment.address}`);
      console.log(`   HashScan: https://hashscan.io/${networkLabel}/contract/${deployment.address}`);
      verified++;
    } else {
      console.log(`❌ ${name}: verification failed — ${job.error?.message ?? "no match"}`);
    }
  }

  if (verified === 0) {
    throw new Error(
      `No verifiable deployments on "${hre.network.name}". Deploy RecurringBuy or remove stale records under deployments/.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});