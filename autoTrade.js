import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
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
  WALLET1_PRIVATE_KEY,
  WALLET2_PRIVATE_KEY,
  WALLET3_PRIVATE_KEY,
  WALLET4_PRIVATE_KEY,
  ADMIN_PRIVATE_KEY,
  RPC_URL = "https://bsc-dataseed.binance.org",
  TARGET_PRICE = "600", // Example price; set to your desired strike
  DURATION_SECONDS = "3600", // 1 hour
  MIN_BNB_STAKE = "0.0002", // minimum stake in BNB
  MAX_BNB_STAKE = "0.0009", // maximum stake in BNB
  TX_INTERVAL_SECONDS = "3600", // base interval (1 transaction per hour)
} = process.env;

const WALLET_KEYS = [
  WALLET1_PRIVATE_KEY,
  WALLET2_PRIVATE_KEY,
  WALLET3_PRIVATE_KEY,
  WALLET4_PRIVATE_KEY,
];

if (!WALLET_KEYS.every(Boolean)) {
  throw new Error("Set WALLET1_PRIVATE_KEY, WALLET2_PRIVATE_KEY, WALLET3_PRIVATE_KEY, and WALLET4_PRIVATE_KEY in .env");
}

if (!ADMIN_PRIVATE_KEY) {
  throw new Error("Set ADMIN_PRIVATE_KEY in .env to fund the wallets.");
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

// Create four wallet accounts from private keys
const walletAccounts = WALLET_KEYS.map((key) =>
  privateKeyToAccount(`0x${key.replace(/^0x/, "")}`)
);

// Create wallet clients for all four wallets
const wallets = walletAccounts.map((account) =>
  createWalletClient({
    account,
    chain: bsc,
    transport: http(RPC_URL),
  })
);

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

async function checkAndFundWallet(walletAddress, walletName, requiredWei) {
  const balance = await publicClient.getBalance({ address: walletAddress });
  const balanceBNB = Number(balance) / 1e18;
  log(`${walletName} balance: ${balanceBNB.toFixed(6)} BNB (${balance} wei)`);
  
  if (balance < requiredWei) {
    const delta = requiredWei - balance;
    const deltaBNB = Number(delta) / 1e18;
    log(`  ⚠️  Insufficient balance. Need ${deltaBNB.toFixed(6)} BNB more. Funding...`);
    await ensureFunding(walletAddress, requiredWei);
    const newBalance = await publicClient.getBalance({ address: walletAddress });
    const newBalanceBNB = Number(newBalance) / 1e18;
    log(`  ✅ Funded. New balance: ${newBalanceBNB.toFixed(6)} BNB`);
  } else {
    log(`  ✅ Sufficient balance`);
  }
  return balance;
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
  // Execute trades continuously forever, cycling through 4 wallets every hour
  const baseIntervalMs = Number(TX_INTERVAL_SECONDS) * 1000;
  const numWallets = 4;
  let i = 0;
  let walletIndex = 0; // 0-3, cycles 1 -> 2 -> 3 -> 4 -> 1 -> ...

  walletAccounts.forEach((acc, idx) => {
    log(`Wallet ${idx + 1} address: ${acc.address}`);
  });
  log("=".repeat(60));

  // Calculate minimum required balance (max stake + gas estimate)
  const gasPrice = await publicClient.getGasPrice();
  const maxStakeWei = parseEther(MAX_BNB_STAKE);
  const estimatedGas = 400_000n; // Conservative estimate
  const gasCost = gasPrice * estimatedGas;
  const gasBuffer = (gasCost * 10n) / 100n; // 10% buffer
  const minRequiredWei = maxStakeWei + gasCost + gasBuffer;
  const minRequiredBNB = Number(minRequiredWei) / 1e18;

  log(`Checking wallet balances (minimum required: ${minRequiredBNB.toFixed(6)} BNB)...`);
  log("=".repeat(60));

  // Check and fund all four wallets at startup
  for (let w = 0; w < numWallets; w++) {
    await checkAndFundWallet(
      walletAccounts[w].address,
      `Wallet ${w + 1}`,
      minRequiredWei
    );
  }

  log("=".repeat(60));
  log("Starting cycling wallet transactions (1 -> 2 -> 3 -> 4 -> 1 -> ...)...");
  log("=".repeat(60));

  while (true) {
    // Select wallet based on current index (1-based number for logs)
    let currentWallet = wallets[walletIndex];
    let walletNumber = walletIndex + 1;
    let walletAddress = walletAccounts[walletIndex].address;

    // Check balance of scheduled wallet before transaction
    const stakeWei = computeStakeWei();
    const gasPrice = await publicClient.getGasPrice();
    const estimatedGas = 400_000n;
    const gasCost = gasPrice * estimatedGas;
    const gasBuffer = (gasCost * 10n) / 100n;
    const requiredWei = stakeWei + gasCost + gasBuffer;

    const balance = await publicClient.getBalance({ address: walletAddress });
    const balanceBNB = Number(balance) / 1e18;

    log(`TX ${i + 1}: Checking Wallet ${walletNumber} (${walletAddress})`);
    log(`  Current balance: ${balanceBNB.toFixed(6)} BNB`);
    log(`  Required: ${(Number(requiredWei) / 1e18).toFixed(6)} BNB`);

    // If scheduled wallet doesn't have enough, try the other wallets in order
    if (balance < requiredWei) {
      let found = false;
      for (let w = 1; w < numWallets; w++) {
        const otherIndex = (walletIndex + w) % numWallets;
        const otherWalletAddress = walletAccounts[otherIndex].address;
        const otherBalance = await publicClient.getBalance({
          address: otherWalletAddress,
        });
        const otherBalanceBNB = Number(otherBalance) / 1e18;

        log(`  ⚠️  Insufficient balance. Checking Wallet ${otherIndex + 1}...`);
        log(`  Wallet ${otherIndex + 1} balance: ${otherBalanceBNB.toFixed(6)} BNB`);

        if (otherBalance >= requiredWei) {
          log(
            `  ✅ Using Wallet ${otherIndex + 1} instead (has sufficient balance)`
          );
          currentWallet = wallets[otherIndex];
          walletNumber = otherIndex + 1;
          walletAddress = otherWalletAddress;
          found = true;
          break;
        }
      }
      if (!found) {
        log(
          `  ⚠️  No other wallet has sufficient balance. Funding Wallet ${walletNumber}...`
        );
        await ensureFunding(walletAddress, requiredWei);
      }
    } else {
      log(`  ✅ Wallet ${walletNumber} has sufficient balance`);
    }

    const isLong = Math.random() < 0.5; // random long or short
    await tradeOnce(currentWallet, stakeWei, isLong, i);

    i += 1;

    // Cycle to next wallet (1 -> 2 -> 3 -> 4 -> 1 -> ...)
    walletIndex = (walletIndex + 1) % numWallets;
    const nextWalletNumber = walletIndex + 1;

    log(
      `Sleeping ${(baseIntervalMs / 1000).toFixed(0)} seconds before next tx (will use Wallet ${nextWalletNumber})...`
    );
    await sleep(baseIntervalMs);
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

