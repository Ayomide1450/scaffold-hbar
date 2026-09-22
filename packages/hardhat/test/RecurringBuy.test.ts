import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import type { MockERC20, MockSaucerSwapRouter, RecurringBuy } from "../typechain-types";

describe("RecurringBuy", () => {
  let mockRouter: MockSaucerSwapRouter;
  let sauce: MockERC20;
  let recurringBuy: RecurringBuy;
  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const WHBAR = "0x0000000000000000000000000000000000003ad2";
  const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";
  const ONE_HBAR = 1_00000000n;

  before(async () => {
    [owner, stranger] = await ethers.getSigners();

    // Place a mock HTS precompile at 0x167 (the address Hedera wires to the real
    // HederaTokenService) so createStream's associateToken call works hermetically.
    const MockHedera = await ethers.getContractFactory("MockHederaTokenService");
    const mockHedera = await MockHedera.deploy();
    const { deployedBytecode } =
      await import("../artifacts/contracts/mocks/MockHederaTokenService.sol/MockHederaTokenService.json");
    await ethers.provider.send("hardhat_setCode", [HTS_PRECOMPILE, deployedBytecode]);
    void mockHedera;
  });

  beforeEach(async () => {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    sauce = await MockERC20.deploy("Sauce", "SAUCE", 6);

    const MockSaucerSwapRouter = await ethers.getContractFactory("MockSaucerSwapRouter");
    mockRouter = await MockSaucerSwapRouter.deploy(WHBAR);

    const RecurringBuy = await ethers.getContractFactory("RecurringBuy");
    recurringBuy = await RecurringBuy.deploy(await mockRouter.getAddress(), WHBAR);
  });

  it("rejects a zero router", async () => {
    const RecurringBuy = await ethers.getContractFactory("RecurringBuy");
    await expect(RecurringBuy.deploy(ethers.ZeroAddress, WHBAR)).to.be.reverted;
  });

  it("creates a stream and funds the exact escrow", async () => {
    const tx = recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 3n, { value: ONE_HBAR * 3n });
    await expect(tx).to.emit(recurringBuy, "StreamCreated");

    expect(await recurringBuy.streamCount()).to.equal(1n);
    const stream = await recurringBuy.getStream(1n);
    expect(stream.owner).to.equal(owner.address);
    expect(stream.tokenOut).to.equal(await sauce.getAddress());
    expect(stream.fundedTinybar).to.equal(ONE_HBAR * 3n);
    expect(stream.nextExecutionAt).to.be.greaterThan(0n);
  });

  it("refunds overflow above maxCadences funding", async () => {
    const before = await ethers.provider.getBalance(owner);
    const tx = await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 2n, {
      value: ONE_HBAR * 3n,
    });
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(owner);
    // 3 HBAR sent, 2 HBAR escrowed, 1 HBAR refunded, net = -2 HBAR - gas
    const netCost = before - after;
    const expected = ONE_HBAR * 2n + (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? 0n);
    expect(netCost - expected).to.be.lessThan(1_000_000n); // tinybar-level rounding tolerance
  });

  it("rejects execution before the cadence elapses", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 3600n, 100n, 1n, { value: ONE_HBAR })
    ).wait();
    await expect(recurringBuy.executeById(1n)).to.be.reverted;
  });

  it("executes a cadence and accrues tokens on the contract", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 2n, { value: ONE_HBAR * 2n })
    ).wait();

    // Fast-forward past the cadence
    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);

    await expect(recurringBuy.executeById(1n))
      .to.emit(recurringBuy, "CadenceExecuted")
      .withArgs(1n, 1n, ONE_HBAR, 95000000n, await sauce.getAddress());

    const stream = await recurringBuy.getStream(1n);
    expect(stream.executedCadences).to.equal(1n);
    expect(stream.fundedTinybar).to.equal(ONE_HBAR); // one cadence consumed
    expect(await recurringBuy.accruedOf(1n, await sauce.getAddress())).to.equal(95000000n);
  });

  it("stops at max cadences but refunds the remaining escrow incl. top-ups", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 1n, { value: ONE_HBAR })
    ).wait();

    // Owner tops up extra escrow after some cadences are already due.
    await (await recurringBuy.topUpStream(1n, { value: ONE_HBAR * 2n })).wait();

    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);
    await (await recurringBuy.executeById(1n)).wait();

    // Max cadences reached: the stream must not keep executing…
    await expect(recurringBuy.executeById(1n))
      .to.be.revertedWithCustomError(recurringBuy, "StreamCompleted")
      .withArgs(1n);

    // …and closing must refund every unswapped tinybar (2 of the 3 HBAR escrowed).
    expect((await recurringBuy.getStream(1n)).fundedTinybar).to.equal(ONE_HBAR * 2n);
    const before = await ethers.provider.getBalance(owner);
    const closeTx = await recurringBuy.closeStream(1n);
    const receipt = await closeTx.wait();
    const after = await ethers.provider.getBalance(owner);
    expect((await recurringBuy.getStream(1n)).fundedTinybar).to.equal(0n);
    const netCost = before - after;
    expect(netCost - (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? 0n)).to.be.lessThan(1_000_000n);
  });

  it("pauses and blocks execution", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 1n, { value: ONE_HBAR })
    ).wait();
    await (await recurringBuy.pauseStream(1n)).wait();

    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);

    await expect(recurringBuy.executeById(1n)).to.be.reverted;
  });

  it("only the owner can withdraw accrued tokens", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 1n, { value: ONE_HBAR })
    ).wait();
    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);
    await (await recurringBuy.executeById(1n)).wait();

    await expect(recurringBuy.connect(stranger).withdraw(1n, await sauce.getAddress())).to.be.reverted;

    // The mock router mints 95% of the input to this contract; withdraw sends it to the owner.
    await expect(recurringBuy.withdraw(1n, await sauce.getAddress()))
      .to.emit(recurringBuy, "TokensWithdrawn")
      .withArgs(1n, owner.address, await sauce.getAddress(), 95000000n);
    expect(await recurringBuy.accruedOf(1n, await sauce.getAddress())).to.equal(0n);
  });

  it("closes a stream and refunds the escrow", async () => {
    await (
      await recurringBuy.createStream(await sauce.getAddress(), ONE_HBAR, 60n, 100n, 3n, { value: ONE_HBAR * 3n })
    ).wait();
    const before = await ethers.provider.getBalance(owner);

    const tx = await recurringBuy.closeStream(1n);
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(owner);

    expect((await recurringBuy.getStream(1n)).fundedTinybar).to.equal(0n);
    // Escrow (3 HBAR) fully refunded; only gas is spent.
    const netCost = before - after;
    expect(netCost - (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? 0n)).to.be.lessThan(1_000_000n);
  });
});
