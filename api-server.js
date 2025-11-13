import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import { CONTRACT_ADDRESS, CHAIN_ID, RPC_URL } from './contract-config.js';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const ADMIN_PRIVATE_KEY = 'bdca8f53f1eb5a7f614d54ca2c97947608c3c847022ccea18b13b0a2737632e0';
const RPC_ENDPOINT = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const FAUCET_AMOUNT =  '0.005'; // BNB to send per claim
const CLAIMS_FILE = './faucet-claims.json';

// Rate limiting: 1 request per IP per hour
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1, // limit each IP to 1 request per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting per wallet: track wallet addresses
const walletClaims = new Map();
const WALLET_COOLDOWN = 60 * 60 * 1000; // 1 hour

// Load or create claims file
function loadClaims() {
  if (fs.existsSync(CLAIMS_FILE)) {
    try {
      const data = fs.readFileSync(CLAIMS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading claims file:', error.message);
      return { claims: [], totalClaims: 0, totalDistributed: '0' };
    }
  }
  return { claims: [], totalClaims: 0, totalDistributed: '0' };
}

// Save claims to file
function saveClaim(claimData) {
  try {
    const allClaims = loadClaims();
    
    allClaims.claims.push(claimData);
    allClaims.totalClaims = allClaims.claims.length;
    
    // Calculate total distributed
    const total = allClaims.claims.reduce((sum, claim) => {
      return sum + parseFloat(claim.amount);
    }, 0);
    allClaims.totalDistributed = total.toFixed(6);
    
    fs.writeFileSync(CLAIMS_FILE, JSON.stringify(allClaims, null, 2));
    console.log('✅ Claim saved to', CLAIMS_FILE);
    return true;
  } catch (error) {
    console.error('❌ Error saving claim:', error.message);
    return false;
  }
}

// Get unique claimers (for airdrop list)
function getUniqueClaimers() {
  const allClaims = loadClaims();
  const uniqueAddresses = new Set();
  
  allClaims.claims.forEach(claim => {
    uniqueAddresses.add(claim.address.toLowerCase());
  });
  
  return Array.from(uniqueAddresses);
}

// Initialize provider
let provider;
let adminWallet;

async function initializeProvider() {
  try {
    provider = new ethers.JsonRpcProvider(RPC_ENDPOINT, undefined, {
      staticNetwork: true,
      batchMaxCount: 1
    });
    
    const network = await provider.getNetwork();
    console.log('✅ Connected to network:', network.name, '- Chain ID:', network.chainId.toString());
    
    if (network.chainId !== BigInt(CHAIN_ID)) {
      throw new Error(`Wrong network! Expected Chain ID ${CHAIN_ID}, got ${network.chainId}`);
    }
    
    if (!ADMIN_PRIVATE_KEY || ADMIN_PRIVATE_KEY === 'your_admin_wallet_private_key_here') {
      throw new Error('Please set ADMIN_PRIVATE_KEY in .env file');
    }
    
    adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    const balance = await provider.getBalance(adminWallet.address);
    console.log('💰 Admin Wallet:', adminWallet.address);
    console.log('💰 Admin Balance:', ethers.formatEther(balance), 'BNB');
    
    if (balance === 0n) {
      console.warn('⚠️ Warning: Admin wallet has no balance!');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize provider:', error.message);
    return false;
  }
}

// Validate Ethereum address
function isValidAddress(address) {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
}

// Check if wallet can claim (cooldown check)
function canWalletClaim(address) {
  const lastClaim = walletClaims.get(address.toLowerCase());
  if (!lastClaim) return true;
  
  const timeSinceLastClaim = Date.now() - lastClaim;
  return timeSinceLastClaim >= WALLET_COOLDOWN;
}

// Get remaining cooldown time
function getRemainingCooldown(address) {
  const lastClaim = walletClaims.get(address.toLowerCase());
  if (!lastClaim) return 0;
  
  const timeSinceLastClaim = Date.now() - lastClaim;
  const remaining = WALLET_COOLDOWN - timeSinceLastClaim;
  return remaining > 0 ? Math.ceil(remaining / 1000 / 60) : 0; // Return minutes
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    network: 'BSC Testnet',
    chainId: CHAIN_ID,
    faucetAmount: FAUCET_AMOUNT + ' BNB'
  });
});

// Get faucet info
app.get('/api/faucet/info', async (req, res) => {
  try {
    const balance = await provider.getBalance(adminWallet.address);
    
    res.json({
      success: true,
      data: {
        network: 'BSC Testnet',
        chainId: CHAIN_ID,
        faucetAmount: FAUCET_AMOUNT,
        faucetAddress: adminWallet.address,
        faucetBalance: ethers.formatEther(balance),
        cooldownMinutes: 60,
        contractAddress: CONTRACT_ADDRESS
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get faucet info'
    });
  }
});

// Claim BNB endpoint
app.post('/api/faucet/claim', limiter, async (req, res) => {
  try {
    const { address } = req.body;
    
    // Validate address
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }
    
    if (!isValidAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }
    
    // Check wallet cooldown
    if (!canWalletClaim(address)) {
      const remainingMinutes = getRemainingCooldown(address);
      return res.status(429).json({
        success: false,
        error: `This wallet has already claimed. Please wait ${remainingMinutes} minutes before claiming again.`
      });
    }
    
    // Check admin balance
    const adminBalance = await provider.getBalance(adminWallet.address);
    const sendAmount = ethers.parseEther(FAUCET_AMOUNT);
    
    if (adminBalance < sendAmount) {
      return res.status(503).json({
        success: false,
        error: 'Faucet is empty. Please try again later.'
      });
    }
    
    // Check if recipient already has enough balance
    const recipientBalance = await provider.getBalance(address);
    if (recipientBalance > ethers.parseEther('0.1')) {
      return res.status(400).json({
        success: false,
        error: 'Your wallet already has sufficient balance. Faucet is for wallets with low balance only.'
      });
    }
    
    console.log(`\n💸 Processing claim for ${address}`);
    console.log(`Sending ${FAUCET_AMOUNT} BNB...`);
    
    // Send BNB
    const tx = await adminWallet.sendTransaction({
      to: address,
      value: sendAmount
    });
    
    console.log('Transaction sent:', tx.hash);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    console.log('✅ Transaction confirmed! Block:', receipt.blockNumber);
    
    // Get new balance
    const newBalance = await provider.getBalance(address);
    
    // Record claim in memory
    walletClaims.set(address.toLowerCase(), Date.now());
    
    // Save claim to file for airdrop tracking
    const claimRecord = {
      address: address,
      amount: FAUCET_AMOUNT,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
      ipAddress: req.ip || req.connection.remoteAddress,
      newBalance: ethers.formatEther(newBalance)
    };
    
    saveClaim(claimRecord);
    
    res.json({
      success: true,
      data: {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        amount: FAUCET_AMOUNT,
        recipient: address,
        newBalance: ethers.formatEther(newBalance),
        explorerUrl: `https://testnet.bscscan.com/tx/${tx.hash}`
      },
      message: `Successfully sent ${FAUCET_AMOUNT} BNB to your wallet!`
    });
    
  } catch (error) {
    console.error('❌ Error processing claim:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to process claim. Please try again later.',
      details: error.message
    });
  }
});

// Get all claims (for admin/airdrop purposes)
app.get('/api/faucet/claims', (req, res) => {
  try {
    const allClaims = loadClaims();
    
    res.json({
      success: true,
      data: {
        totalClaims: allClaims.totalClaims,
        totalDistributed: allClaims.totalDistributed + ' BNB',
        uniqueClaimers: getUniqueClaimers().length,
        claims: allClaims.claims
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load claims data'
    });
  }
});

// Get airdrop list (unique addresses only)
app.get('/api/airdrop/list', (req, res) => {
  try {
    const uniqueAddresses = getUniqueClaimers();
    const allClaims = loadClaims();
    
    // Create detailed airdrop list with claim counts
    const airdropList = uniqueAddresses.map(address => {
      const userClaims = allClaims.claims.filter(
        c => c.address.toLowerCase() === address
      );
      
      const totalClaimed = userClaims.reduce((sum, claim) => {
        return sum + parseFloat(claim.amount);
      }, 0);
      
      return {
        address: address,
        claimCount: userClaims.length,
        totalClaimed: totalClaimed.toFixed(6),
        firstClaim: userClaims[0]?.timestamp,
        lastClaim: userClaims[userClaims.length - 1]?.timestamp
      };
    });
    
    res.json({
      success: true,
      data: {
        totalAddresses: uniqueAddresses.length,
        addresses: airdropList
      },
      message: 'Airdrop list generated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate airdrop list'
    });
  }
});

// Check claim status for an address
app.get('/api/faucet/status/:address', (req, res) => {
  const { address } = req.params;
  
  if (!isValidAddress(address)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wallet address'
    });
  }
  
  const canClaim = canWalletClaim(address);
  const remainingMinutes = getRemainingCooldown(address);
  
  res.json({
    success: true,
    data: {
      address: address,
      canClaim: canClaim,
      remainingCooldown: canClaim ? 0 : remainingMinutes,
      cooldownUnit: 'minutes'
    }
  });
});

// Start server
async function startServer() {
  console.log('🚀 Starting BNB Testnet Faucet API...\n');
  
  const initialized = await initializeProvider();
  
  if (!initialized) {
    console.error('Failed to initialize. Please check your configuration.');
    process.exit(1);
  }
  
  app.listen(PORT, () => {
    console.log('\n✅ API Server Running!');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/health`);
    console.log(`💧 Faucet Info: http://localhost:${PORT}/api/faucet/info`);
    console.log(`\n💡 Endpoints:`);
    console.log(`   POST /api/faucet/claim - Claim ${FAUCET_AMOUNT} BNB`);
    console.log(`   GET  /api/faucet/status/:address - Check claim status`);
    console.log(`   GET  /api/faucet/info - Get faucet information`);
    console.log(`   GET  /api/faucet/claims - Get all claims history`);
    console.log(`   GET  /api/airdrop/list - Get airdrop eligible addresses`);
    console.log(`\n⏱️  Rate Limit: 1 claim per IP per hour`);
    console.log(`⏱️  Wallet Cooldown: 1 hour between claims`);
    console.log(`📝 Claims saved to: ${CLAIMS_FILE}\n`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

