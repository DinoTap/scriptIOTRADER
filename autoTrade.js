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
  BNB_STAKE = "0.00001", // Base minimum stake; will randomize up to 0.00002
  TX_INTERVAL_SECONDS = "1200", // 20 minutes between tx to fit 3 tx in ~1 hour
  MAX_TX = "0", // 0 or empty = run continuously
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

// Randomize stake between base and base*2 to vary 0.00001 -> 0.00002
const computeStakeWei = () => {
  const base = parseEther(BNB_STAKE);
  const multiplier = 1 + Math.random(); // 1.0 to <2.0
  const randomized = BigInt(Math.floor(Number(base) * multiplier));
  return randomized;
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
  // Execute trades continuously (or up to MAX_TX)
  const intervalMs = Number(TX_INTERVAL_SECONDS) * 1000;
  const maxTx = Number(MAX_TX || "0");
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
    const isLong = i % 2 === 0; // alternate long/short
    await tradeOnce(traderWallet, stakeWei, isLong, i);

    i += 1;
    if (maxTx > 0 && i >= maxTx) {
      log(`Reached MAX_TX=${maxTx}. Exiting.`);
      break;
    }

    log(`Sleeping ${intervalMs / 1000} seconds before next tx...`);
    await sleep(intervalMs);
  }

  log("All transactions submitted and confirmed.");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

