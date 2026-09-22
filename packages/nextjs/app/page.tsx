"use client";

import { useState } from "react";
import Image from "next/image";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { ArrowPathIcon, CurrencyDollarIcon, PauseIcon, PlayIcon, PlusIcon } from "@heroicons/react/24/outline";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";

/** SAUCE token on Hedera testnet (0.0.1183558) — long-zero EVM address. */
const SAUCE_TESTNET = "0x0000000000000000000000000000000000120f46";

/**
 * Convert a human "1.5 HBAR" string into tinybars (the scale the contract observes
 * for msg.value and balances: 1 HBAR = 1e8 tinybars).
 */
function hbarToTinybar(hbar: string): bigint {
  const [whole = "0", frac = ""] = hbar.trim().split(".");
  if (frac.length > 8) throw new Error("Too many decimals");
  return BigInt(whole) * 10n ** 8n + BigInt(frac.padEnd(8, "0") || "0");
}

/**
 * Convert a human "1.5 HBAR" string into wei for the transaction `value` field.
 * The Hedera JSON-RPC relay divides this by 1e10, so the contract ultimately sees
 * the equivalent tinybar amount.
 */
function hbarToWei(hbar: string): bigint {
  const [whole = "0", frac = ""] = hbar.trim().split(".");
  if (frac.length > 18) throw new Error("Too many decimals");
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0") || "0");
}

const Home: NextPage = () => {
  const { address: connectedAddress, status } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isReconnecting = status === "reconnecting" || status === "connecting";
  const isConnected = status === "connected" && !!connectedAddress;

  const { data: streamCount = 0n, refetch: refetchCount } = useScaffoldReadContract({
    contractName: "RecurringBuy",
    functionName: "streamCount",
  });

  const streamIds = Array.from({ length: Number(streamCount) }, (_, i) => BigInt(i + 1));

  return (
    <>
      <div className="flex items-center flex-col grow">
        <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-16 px-5">
          <div className="flex flex-col items-center max-w-2xl mx-auto text-center">
            <Image
              src="/Hedera-Icon-White.svg"
              alt="Hedera icon"
              width={64}
              height={64}
              className="mb-4 hidden dark:block"
            />
            <Image src="/Hedera-Icon-Dark.svg" alt="Hedera icon" width={64} height={64} className="mb-4 dark:hidden" />
            <h1 className="text-3xl md:text-4xl font-bold text-white dark:text-white">SaucerSwap Recurring Buy</h1>
            <p className="mt-3 text-white/80 dark:text-white/60 max-w-xl">
              Set up automatic dollar-cost averaging into any HTS token on the SaucerSwap V1 DEX — pre-fund a stream in
              HBAR, pick a cadence, and let anyone keep it on schedule.
            </p>
          </div>
        </div>

        <div className="w-full max-w-4xl mx-auto px-5 -mt-8">
          <div className="bg-base-100 rounded-2xl shadow-lg p-8">
            {isReconnecting ? (
              <div className="flex flex-col items-center gap-2">
                <p className="font-semibold text-sm text-base-content/60 uppercase tracking-wider m-0">Connecting…</p>
                <div className="h-8 w-48 rounded bg-base-200 animate-pulse" aria-hidden />
              </div>
            ) : isConnected ? (
              <div className="flex flex-col items-center gap-2">
                <p className="font-semibold text-sm text-base-content/60 uppercase tracking-wider m-0">
                  Connected Address
                </p>
                <HederaAddress address={connectedAddress} chain={targetNetwork} />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="font-semibold text-sm text-base-content/60 uppercase tracking-wider m-0">
                  Connect HashPack to create or manage streams
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-4xl mx-auto px-5 mt-8 pb-16">
          <CreateStreamForm onCreated={() => refetchCount()} disabled={!isConnected} />
          <StreamList streamIds={streamIds} />
          <QuickStart isConnected={isConnected} />
        </div>
      </div>
    </>
  );
};

function CreateStreamForm({ onCreated, disabled }: { onCreated: () => void; disabled: boolean }) {
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "RecurringBuy" });
  const [tokenOut, setTokenOut] = useState(SAUCE_TESTNET);
  const [buyHbar, setBuyHbar] = useState("0.5");
  const [cadenceMin, setCadenceMin] = useState("10");
  const [slippageBps, setSlippageBps] = useState("100");
  const [maxCadences, setMaxCadences] = useState("52");
  const [fundHbar, setFundHbar] = useState("26");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      setBusy(true);
      const value = hbarToWei(fundHbar);
      await writeContractAsync({
        functionName: "createStream",
        args: [
          tokenOut as `0x${string}`,
          hbarToTinybar(buyHbar),
          BigInt(Number(cadenceMin) * 60),
          BigInt(slippageBps),
          BigInt(maxCadences),
        ],
        value,
      });
      notification.success("Stream created. Escrow funded — a keeper can execute once the first cadence elapses.");
      onCreated();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "Failed to create stream");
    } finally {
      setBusy(false);
    }
  }

  const field = "input input-bordered input-sm w-full";
  const label = "label text-xs text-base-content/70 font-medium";

  return (
    <div className="bg-base-100 rounded-2xl shadow-md p-8 border border-base-300 mb-8">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-10 h-10 rounded-full hedera-gradient flex items-center justify-center">
          <PlusIcon className="h-5 w-5 text-white" />
        </div>
        <h2 className="font-bold text-lg m-0">New recurring buy stream</h2>
      </div>

      <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <span className={label}>Token to buy (HTS address)</span>
          <input className={field} value={tokenOut} onChange={e => setTokenOut(e.target.value)} required />
          <span className="text-xs text-base-content/50 mt-1 block">
            Testnet SAUCE: 0.0.1183558 (needs a WHBAR V1 pair)
          </span>
        </div>

        <div>
          <span className={label}>HBAR per cadence</span>
          <input
            className={field}
            type="number"
            min="0.00000001"
            step="any"
            value={buyHbar}
            onChange={e => setBuyHbar(e.target.value)}
            required
          />
        </div>
        <div>
          <span className={label}>Cadence (minutes)</span>
          <input
            className={field}
            type="number"
            min="1"
            value={cadenceMin}
            onChange={e => setCadenceMin(e.target.value)}
            required
          />
        </div>
        <div>
          <span className={label}>Max slippage (bps)</span>
          <input
            className={field}
            type="number"
            min="1"
            max="500"
            value={slippageBps}
            onChange={e => setSlippageBps(e.target.value)}
            required
          />
          <span className="text-xs text-base-content/50 mt-1 block">100 bps = 1%</span>
        </div>
        <div>
          <span className={label}>Max cadences (0 = until funds run out)</span>
          <input
            className={field}
            type="number"
            min="0"
            value={maxCadences}
            onChange={e => setMaxCadences(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <span className={label}>Initial funding (HBAR escrowed in contract)</span>
          <input
            className={field}
            type="number"
            min="0.00000001"
            step="any"
            value={fundHbar}
            onChange={e => setFundHbar(e.target.value)}
            required
          />
        </div>

        <div className="md:col-span-2 flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={disabled || busy}>
            {busy ? "Sending…" : "Create stream"}{" "}
            <HederaPortalFaucet variant="link" label="get testnet HBAR" showIcon={false} />
          </button>
        </div>
      </form>
    </div>
  );
}

function StreamList({ streamIds }: { streamIds: bigint[] }) {
  if (streamIds.length === 0) {
    return (
      <div className="bg-base-100 rounded-2xl shadow-md p-10 border border-base-300 text-center">
        <p className="m-0 text-sm text-base-content/60">No streams yet — create one above.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 mb-8">
      {streamIds.map(id => (
        <StreamCard key={id.toString()} streamId={id} />
      ))}
    </div>
  );
}

function StreamCard({ streamId }: { streamId: bigint }) {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { data: s } = useScaffoldReadContract({
    contractName: "RecurringBuy",
    functionName: "getStream",
    args: [streamId],
  });
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "RecurringBuy" });
  const [busy, setBusy] = useState<string | null>(null);

  const stream = s as unknown as Record<string, unknown> | undefined;
  const owner = stream?.owner as `0x${string}` | undefined;
  const isOwner = !!connectedAddress && owner?.toLowerCase() === connectedAddress.toLowerCase();
  const nextExecutionIn = stream
    ? (stream.nextExecutionAt as bigint) - BigInt(Math.floor(Date.now() / 1000))
    : undefined;

  async function act(functionName: string, args: readonly unknown[] = []) {
    if (!functionName) return;
    try {
      setBusy(functionName);
      await writeContractAsync({ functionName: functionName as any, args: args as never });
      notification.success("Transaction sent");
    } catch (err) {
      notification.error(err instanceof Error ? err.message : `Failed to call ${functionName}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-base-100 rounded-2xl shadow-md p-6 border border-base-300">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold m-0">Stream #{streamId.toString()}</h3>
          <p className="text-xs text-base-content/60 m-0 mt-0.5">
            Owner: {owner ? <HederaAddress address={owner} chain={targetNetwork} /> : "…"}
          </p>
        </div>
        <div className="text-right">
          <p className="m-0 text-lg font-mono font-semibold">{formatHbarForDisplay(stream)} HBAR / cadence</p>
          <p className="text-xs text-base-content/60 m-0">
            {stream?.isPaused
              ? "Paused"
              : nextExecutionIn !== undefined && nextExecutionIn > 0n
                ? `next swap in ${formatCadence(nextExecutionIn)}`
                : "due now"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-sm btn-primary"
          disabled={!stream || !!busy}
          onClick={() => act("executeById", [streamId])}
        >
          <ArrowPathIcon className="h-4 w-4" /> {busy === "executeById" ? "Executing…" : "Execute (keeper)"}
        </button>
        {isOwner && (
          <>
            <button
              className="btn btn-sm"
              disabled={!!busy}
              onClick={() => act(stream?.isPaused ? "resumeStream" : "pauseStream", [streamId])}
            >
              {stream?.isPaused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
              {stream?.isPaused ? "Resume" : "Pause"}
            </button>
            <button
              className="btn btn-sm"
              disabled={!stream || !!busy}
              onClick={() => act("withdraw", [streamId, stream?.tokenOut])}
            >
              <CurrencyDollarIcon className="h-4 w-4" /> Withdraw tokens
            </button>
            <button
              className="btn btn-sm btn-outline btn-error"
              disabled={!!busy}
              onClick={() => act("closeStream", [streamId])}
            >
              Close & refund HBAR
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function formatCadence(secs: bigint): string {
  const n = Number(secs);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  if (n < 86400) return `${Math.floor(n / 3600)}h`;
  return `${Math.floor(n / 86400)}d`;
}

function formatHbarForDisplay(stream: Record<string, unknown> | undefined): string {
  if (!stream) return "—";
  const units = stream.buyAmountTinybar as bigint;
  const whole = units / 10n ** 8n;
  const frac = (units % 10n ** 8n).toString().padStart(8, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

function QuickStart({ isConnected }: { isConnected: boolean }) {
  const steps: Array<{ title: string; body: string; code?: string }> = [
    {
      title: "Fund your account",
      body: "Create or refill a Hedera testnet account via the official faucet, then connect HashPack.",
      code: "yarn account:generate",
    },
    {
      title: "Deploy the contract",
      body: "Deploys RecurringBuy against the SaucerSwap V1 router and WHBAR from utils/saucerSwap.ts.",
      code: "yarn hardhat:deploy --network hederaTestnet",
    },
    {
      title: "Create a stream",
      body: "Pick the token, HBAR per cadence, cadence length, max slippage and escrow funding. The contract self-associates with the output token via the HTS precompile.",
    },
    {
      title: "Let keepers run it",
      body: "Anyone can call executeById once the cadence elapses; the stream runs until max cadences are hit or the escrow runs dry.",
    },
  ];

  return (
    <div className="mt-8 bg-base-100 rounded-2xl shadow-md p-8 border border-base-300">
      <h3 className="font-bold text-lg mb-4">How it works</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((step, i) => (
          <div key={step.title} className="flex items-start gap-3">
            <span className="font-bold text-primary text-lg leading-none mt-0.5">{i + 1}</span>
            <div>
              <p className="m-0 font-medium">{step.title}</p>
              <p className="m-0 mt-1 text-sm text-base-content/70">{step.body}</p>
              {step.code && (
                <code className="text-xs bg-base-200 px-2 py-1 rounded inline-block mt-2">{step.code}</code>
              )}
            </div>
          </div>
        ))}
      </div>
      {!isConnected && (
        <p className="mt-4 text-sm text-base-content/70 mb-0">
          Need testnet HBAR? <HederaPortalFaucet variant="link" label="Get testnet HBAR" showIcon={false} />
        </p>
      )}
    </div>
  );
}

export default Home;
