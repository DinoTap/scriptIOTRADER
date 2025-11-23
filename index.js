import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { CONTRACT_ADDRESS, CONTRACT_ABI, CHAIN_ID, RPC_URL } from './contract-config.js';
import fs from 'fs';

dotenv.config();

// Configuration
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const RPC_ENDPOINT = 'https://bsc-dataseed.binance.org/';
const FUNDING_AMOUNT = '0.0001'; // BNB to send to each new wallet
const PREDICTION_AMOUNT = '0.01'; // BNB for prediction (not used, random amount used instead)
const WALLETS_FILE = './wallets.json';

// Trading symbols and sample data
const TRADING_SYMBOLS = ['BTC', 'ETH', 'MATIC', 'BNB', 'SOL', 'ADA', 'LINK'];


// Helper function to get random element from array
function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper function to get random number in range
function getRandomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to get random time between 40-50 minutes in milliseconds
function getRandomInterval() {
  const minutes = getRandomInRange(40, 50);
  return minutes * 60 * 1000;
}

// Helper function to get random amount between 0.00001 and 0.00002 BNB
function getRandomAmount() {
  const min = 0.00001;
  const max = 0.00002;
  const random = Math.random() * (max - min) + min;
  return random.toFixed(6); // Return as string with 6 decimals
}

// Load or create wallets file
function loadWallets() {
  if (fs.existsSync(WALLETS_FILE)) {
    const data = fs.readFileSync(WALLETS_FILE, 'utf8');
    return JSON.parse(data);
  }
  return { wallets: [] };
}

// Save wallets to file
function saveWallets(walletsData) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(walletsData, null, 2));
}

// Generate a new wallet
function generateWallet() {
  const wallet = ethers.Wallet.createRandom();
  console.log('\n🔐 New Wallet Generated:');
  console.log('Address:', wallet.address);
  console.log('Private Key:', wallet.privateKey);
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date().toISOString()
  };
}

// Fund new wallet from admin wallet
async function fundWallet(provider, newWalletAddress) {
  try {
    console.log('\n💰 Funding new wallet...');
    const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    
    // Check admin balance
    const adminBalance = await provider.getBalance(adminWallet.address);
    console.log(`Admin Balance: ${ethers.formatEther(adminBalance)} BNB`);
    
    const fundingAmountWei = ethers.parseEther(FUNDING_AMOUNT);
    
    if (adminBalance < fundingAmountWei) {
      throw new Error('Insufficient admin wallet balance');
    }
    
    // Send funds to new wallet
    const tx = await adminWallet.sendTransaction({
      to: newWalletAddress,
      value: fundingAmountWei
    });
    
    console.log('Funding transaction sent:', tx.hash);
    console.log('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Funding successful! Block:', receipt.blockNumber);
    
    // Check new wallet balance
    const newBalance = await provider.getBalance(newWalletAddress);
    console.log(`New Wallet Balance: ${ethers.formatEther(newBalance)} BNB`);
    
    return receipt;
  } catch (error) {
    console.error('❌ Error funding wallet:', error.message);
    throw error;
  }
}

// Create a price prediction transaction
async function createPricePrediction(provider, walletPrivateKey) {
  try {
    console.log('\n🎯 Creating Price Prediction...');
    
    const wallet = new ethers.Wallet(walletPrivateKey, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    
    // Check wallet balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet Balance: ${ethers.formatEther(balance)} BNB`);
    
    // Get random prediction amount
    const predictionAmount = getRandomAmount();
    const predictionAmountWei = ethers.parseEther(predictionAmount);
    
    if (balance < predictionAmountWei * 2n) { // Need some extra for gas
      throw new Error('Insufficient wallet balance for prediction');
    }
    
    // Generate random prediction parameters
    const symbol = getRandomElement(TRADING_SYMBOLS);
    const entryPrice = getRandomInRange(1000, 100000); // Random entry price
    const isAbove = Math.random() > 0.5; // Random direction
    const priceChange = getRandomInRange(5, 20); // 5-20% price change
    const targetPrice = isAbove 
      ? Math.floor(entryPrice * (1 + priceChange / 100))
      : Math.floor(entryPrice * (1 - priceChange / 100));
    const leverage = getRandomInRange(1, 5); // 1x to 5x leverage
    const duration = getRandomInRange(3600, 86400); // 1 hour to 1 day in seconds
    
    console.log('\n📊 Prediction Parameters:');
    console.log(`Symbol: ${symbol}`);
    console.log(`Entry Price: $${entryPrice}`);
    console.log(`Target Price: $${targetPrice}`);
    console.log(`Direction: ${isAbove ? '📈 ABOVE' : '📉 BELOW'}`);
    console.log(`Leverage: ${leverage}x`);
    console.log(`Duration: ${duration}s (${Math.floor(duration / 3600)}h)`);
    console.log(`Bet Amount: ${predictionAmount} BNB`);
    
    // Create the prediction
    const tx = await contract.createPricePrediction(
      symbol,
      entryPrice,
      targetPrice,
      isAbove,
      leverage,
      duration,
      { value: predictionAmountWei }
    );
    
    console.log('\n📤 Transaction sent:', tx.hash);
    console.log('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Prediction created successfully!');
    console.log('Block:', receipt.blockNumber);
    console.log('Gas Used:', receipt.gasUsed.toString());
    
    // Parse event logs to get prediction ID
    const event = receipt.logs.find(log => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed && parsed.name === 'PricePredictionCreated';
      } catch {
        return false;
      }
    });
    
    if (event) {
      const parsed = contract.interface.parseLog(event);
      console.log('Prediction ID:', parsed.args.predictionId.toString());
    }
    
    return {
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      symbol,
      entryPrice,
      targetPrice,
      isAbove,
      leverage,
      duration,
      amount: predictionAmount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error creating prediction:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    throw error;
  }
}

// Main loop function
async function runBot() {
  console.log('🤖 IOTrader Bot Starting...');
  console.log('Network: BSC Mainnet (Binance Smart Chain)');
  console.log('Chain ID:', CHAIN_ID);
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log(`Interval: Random 40-50 minutes`);
  console.log(`Bet Amount: Random 0.00001-0.00002 BNB\n`);
  
  // Validate admin private key
  if (!ADMIN_PRIVATE_KEY || ADMIN_PRIVATE_KEY === 'your_admin_wallet_private_key_here') {
    console.error('❌ Please set ADMIN_PRIVATE_KEY in .env file');
    process.exit(1);
  }
  
  // Setup provider with static network to avoid ENS lookups
  const provider = new ethers.JsonRpcProvider(RPC_ENDPOINT, {
    chainId: CHAIN_ID,
    name: 'bsc-mainnet',
    ensAddress: null
  }, {
    staticNetwork: true,
    batchMaxCount: 1
  });
  
  // Verify network
  try {
    const network = await provider.getNetwork();
    console.log('✅ Connected to network:', network.name, '- Chain ID:', network.chainId.toString());
    
    if (network.chainId !== BigInt(CHAIN_ID)) {
      console.error(`❌ Wrong network! Expected Chain ID ${CHAIN_ID}, got ${network.chainId}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to connect to network:', error.message);
    process.exit(1);
  }
  
  let walletsData = loadWallets();
  let currentWallet = null;
  let transactionCount = 0;
  
  async function executeTransaction() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log(`🔄 Transaction Cycle #${transactionCount + 1}`);
      console.log('Time:', new Date().toLocaleString());
      console.log('='.repeat(60));
      
      // Generate new wallet
      const newWallet = generateWallet();
      
      // Fund the wallet
      await fundWallet(provider, newWallet.address);
      
      // Wait a bit for the funding to be confirmed
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Create price prediction
      const prediction = await createPricePrediction(provider, newWallet.privateKey);
      
      // Save wallet and transaction info
      walletsData.wallets.push({
        ...newWallet,
        transactions: [prediction]
      });
      saveWallets(walletsData);
      
      currentWallet = newWallet;
      transactionCount++;
      
      console.log('\n✅ Cycle completed successfully!');
      console.log(`Total transactions: ${transactionCount}`);
      
    } catch (error) {
      console.error('\n❌ Error in transaction cycle:', error.message);
      console.error('Will retry in next interval...');
    }
  }
  
  // Run first transaction immediately
  await executeTransaction();
  
  // Schedule subsequent transactions
  function scheduleNext() {
    const interval = getRandomInterval();
    const nextRunMinutes = Math.floor(interval / 60000);
    console.log(`\n⏰ Next transaction scheduled in ${nextRunMinutes} minutes`);
    console.log(`Next run at: ${new Date(Date.now() + interval).toLocaleString()}`);
    
    setTimeout(async () => {
      await executeTransaction();
      scheduleNext();
    }, interval);
  }
  
  scheduleNext();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  console.log('Wallets data saved to:', WALLETS_FILE);
  process.exit(0);
});

// Start the bot
runBot().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

