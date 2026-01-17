import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { bsc } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fetch, { Headers, Request, Response } from "node-fetch";

// Polyfill fetch for Node versions without global fetch (needed by viem)
if (typeof globalThis.fetch !== "function") {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Minimal ABI slice for long/short functions on IOTraderUnified
const CONTRACT_ABI = [
  {
    name: "long",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { internalType: "uint8", name: "pair", type: "uint8" },
      { internalType: "uint256", name: "targetPrice", type: "uint256" },
      { internalType: "uint256", name: "duration", type: "uint256" },
      { internalType: "bool", name: "stakeUSDT", type: "bool" },
      { internalType: "uint256", name: "usdtAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "short",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { internalType: "uint8", name: "pair", type: "uint8" },
      { internalType: "uint256", name: "targetPrice", type: "uint256" },
      { internalType: "uint256", name: "duration", type: "uint256" },
      { internalType: "bool", name: "stakeUSDT", type: "bool" },
      { internalType: "uint256", name: "usdtAmount", type: "uint256" },
    ],
    outputs: [],
  },
];

const CONTRACT_ADDRESS = "0x1b3f2f99cc5eaD46084075751372F9dE9133f18e";

const {
  ADMIN_PRIVATE_KEY,
  RPC_URL = "https://bsc-dataseed.binance.org",
  TARGET_PRICE = "600", // Example price; set to your desired strike
  DURATION_SECONDS = "3600", // 1 hour
  MIN_BNB_STAKE = "0.0002", // minimum stake in BNB
  MAX_BNB_STAKE = "0.0009", // maximum stake in BNB
  TX_INTERVAL_SECONDS = "6", // base interval (10 transactions per minute, ~6 seconds each)
} = process.env;

if (!ADMIN_PRIVATE_KEY) {
  throw new Error("Set ADMIN_PRIVATE_KEY in .env to fund the child wallet.");
}

// Pair enum from the dapp (0=BTC, 1=ETH, 2=BNB, 3=USDT). Using BNB here.
const PAIR_ENUM = 2;

const publicClient = createPublicClient({
  chain: bsc,
  transport: http(RPC_URL),
});

const adminAccount = privateKeyToAccount(
  `0x${ADMIN_PRIVATE_KEY.replace(/^0x/, "")}`
);

const adminWallet = createWalletClient({
  account: adminAccount,
  chain: bsc,
  transport: http(RPC_URL),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (...args) => console.log(new Date().toISOString(), "-", ...args);

// Randomize stake between MIN_BNB_STAKE and MAX_BNB_STAKE
const computeStakeWei = () => {
  const min = parseEther(MIN_BNB_STAKE);
  const max = parseEther(MAX_BNB_STAKE);
  if (max <= min) return min;

  const range = max - min;
  const rand = BigInt(Math.floor(Math.random() * Number(range + 1n)));
  return min + rand;
};

async function fundTrader(traderAddress, amountWei) {
  log(`Funding trader ${traderAddress} with ${amountWei} wei`);
  const hash = await adminWallet.sendTransaction({
    account: adminAccount,
    to: traderAddress,
    value: amountWei,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log("Funding confirmed:", receipt.transactionHash);
}

async function ensureFunding(traderAddress, requiredWei) {
  const balance = await publicClient.getBalance({ address: traderAddress });
  if (balance >= requiredWei) return;

  const delta = requiredWei - balance;
  log(
    `Funding trader (needs ${delta} wei more). Current balance: ${balance} wei`
  );
  const hash = await adminWallet.sendTransaction({
    account: adminAccount,
    to: traderAddress,
    value: delta,
    gasPrice: await publicClient.getGasPrice(),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  log("Top-up confirmed:", hash);
}

async function tradeOnce(traderWallet, stakeWei, isLong, index) {
  const functionName = isLong ? "long" : "short";
  let gasPrice = await publicClient.getGasPrice();

  // Minimal prefund before estimating (avoid estimate failures on zero balance)
  const preFundGasLimit = 400_000n;
  const preFundNeed = stakeWei + gasPrice * preFundGasLimit;
  await ensureFunding(traderWallet.account.address, preFundNeed);

  // Now estimate with real values
  const estimatedGas = await publicClient.estimateContractGas({
    account: traderWallet.account,
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName,
    args: [
      PAIR_ENUM,
      parseUnits(TARGET_PRICE.toString(), 8),
      BigInt(DURATION_SECONDS),
      false,
      0n,
    ],
    value: stakeWei,
    gasPrice,
  });

  // Add 10% buffer for safety
  const gasBuffer = (gasPrice * estimatedGas * 10n) / 100n;
  const requiredWei = stakeWei + gasPrice * estimatedGas + gasBuffer;

  await ensureFunding(traderWallet.account.address, requiredWei);

  log(
    `TX ${index + 1}: ${functionName} stake=${stakeWei} wei gasPrice=${gasPrice} estimatedGas=${estimatedGas}`
  );

  const hash = await traderWallet.writeContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName,
    args: [
      PAIR_ENUM,
      parseUnits(TARGET_PRICE.toString(), 8), // contract expects 8 decimals
      BigInt(DURATION_SECONDS),
      false, // stakeUSDT = false so BNB is used
      0n, // usdtAmount is 0 when staking BNB
    ],
    value: stakeWei,
    gasPrice,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`TX ${index + 1} confirmed:`, receipt.transactionHash);
}

async function main() {
  // Execute trades continuously forever (10 transactions per minute)
  const baseIntervalMs = Number(TX_INTERVAL_SECONDS) * 1000;
  let i = 0;

  while (true) {
    // Generate a new wallet for each transaction
    const traderAccount = privateKeyToAccount(generatePrivateKey());
    log(`TX ${i + 1}: Generated new trader wallet:`, traderAccount.address);
    log(
      "⚠️ Private key:",
      traderAccount?.privateKey ?? "(unavailable)",
      "(do not share)"
    );

    // Create wallet client for this transaction
    const traderWallet = createWalletClient({
      account: traderAccount,
      chain: bsc,
      transport: http(RPC_URL),
    });

    const stakeWei = computeStakeWei();
    const isLong = Math.random() < 0.5; // random long or short
    await tradeOnce(traderWallet, stakeWei, isLong, i);

    i += 1;

    // Jitter the interval so trades are at random times, approximately 10 per minute
    const jitterFactor = 0.5 + Math.random(); // 0.5x to 1.5x
    const intervalMs = baseIntervalMs * jitterFactor;
    log(`Sleeping ${(intervalMs / 1000).toFixed(0)} seconds before next tx...`);
    await sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

