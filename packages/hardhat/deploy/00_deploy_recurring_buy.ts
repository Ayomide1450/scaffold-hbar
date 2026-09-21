import * as fs from "fs";
import * as path from "path";

import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { resolveHederaContractId } from "../utils/resolveHederaContractId";
import { getSaucerSwapV1 } from "../utils/saucerSwap";

const HEDERA_CHAIN_IDS = new Set([295, 296]);

const deployRecurringBuy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const chainIdRes = await hre.network.provider.send("eth_chainId", []);
  const chainId = Number(chainIdRes);

  const saucer = getSaucerSwapV1(chainId);

  const deployment = await deploy("RecurringBuy", {
    from: deployer,
    args: [saucer.routerEvmAddress, saucer.whbarEvmAddress],
    log: true,
    autoMine: true,
    gasLimit: "3000000",
    gasPrice: await getDeployGasPrice(hre),
  });

  if (HEDERA_CHAIN_IDS.has(chainId) && deployment.address) {
    const hederaContractId = await resolveHederaContractId(deployment.address, chainId);
    const deploymentPath = path.join(hre.config.paths.deployments, hre.network.name, "RecurringBuy.json");
    const deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Record<string, unknown>;
    deploymentJson.hederaContractId = hederaContractId;
    fs.writeFileSync(deploymentPath, `${JSON.stringify(deploymentJson, null, 2)}\n`);
    console.log(`Resolved Hedera contract id: ${hederaContractId}`);
    console.log(`SaucerSwap V1 router (${saucer.network}): ${saucer.routerId} (${saucer.routerEvmAddress})`);
  }
};

deployRecurringBuy.tags = ["RecurringBuy"];
export default deployRecurringBuy;
