import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import admin from 'firebase-admin';
import { CONTRACT_ADDRESS, CHAIN_ID, RPC_URL } from './contract-config.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 8080;

// Configuration
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const RPC_ENDPOINT = 'https://bsc-dataseed.binance.org/';
const FAUCET_AMOUNT = '0.0001'; // BNB to send per claim
const CLAIMS_FILE = './faucet-claims.json';

// Firebase Configuration
const FIREBASE_PROJECT_ID = 'iotrade-9840d';
const FIREBASE_COLLECTION = 'users'; // Collection name in Firestore

// Initialize Firebase Admin SDK
let firestore;
try {
  // Option 1: Use service account key from environment variable (recommended for Railway)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: FIREBASE_PROJECT_ID
    });
    firestore = admin.firestore();
    console.log('✅ Firebase Admin SDK initialized with service account key from environment variable');
  } 
  // Option 2: Use service account JSON file (for local development)
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || fs.existsSync('./iotrade-9840d-firebase-adminsdk-fbsvc-fb18a46d05.json')) {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './iotrade-9840d-firebase-adminsdk-fbsvc-fb18a46d05.json';
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: FIREBASE_PROJECT_ID
    });
    firestore = admin.firestore();
    console.log('✅ Firebase Admin SDK initialized with service account file:', serviceAccountPath);
  }
  // Option 3: Use default credentials (for local development with gcloud)
  else {
    admin.initializeApp({
      projectId: FIREBASE_PROJECT_ID
    });
    firestore = admin.firestore();
    console.log('✅ Firebase Admin SDK initialized with default credentials');
  }
} catch (error) {
  console.log('⚠️ Firebase initialization error:', error.message);
  console.log('⚠️ Claims will be allowed without Firestore verification');
  firestore = null;
}

// Security Configuration - Only allow requests from iotrader.io
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['https://iotrader.io', 'https://www.iotrader.io'];

// CORS Configuration - Strictly only allow requests from iotrader.io
const corsOptions = {
  origin: function (origin, callback) {
    // Block requests with no origin (Postman, curl, etc.)
    if (!origin) {
      return callback(new Error('Not allowed by CORS - Origin header required'));
    }
    
    // Only allow requests from iotrader.io domains
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS - Only ${ALLOWED_ORIGINS.join(', ')} are allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Rate limiting: 5 requests per hour per IP
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

// Rate limiting per wallet: 1 hour cooldown
const walletClaims = new Map();
const WALLET_COOLDOWN = 60 * 60 * 1000; // 1 hour in milliseconds

// Check if wallet exists in Firestore users collection
async function checkWalletInFirestore(walletAddress) {
  if (!firestore) {
    // If Firebase is not initialized, allow the claim (fallback mode)
    console.log('⚠️ Firestore not initialized, allowing claim without verification');
    return true;
  }
  
  try {
    // Normalize wallet address to lowercase for comparison
    const normalizedAddress = walletAddress.toLowerCase();
    
    // Query Firestore users collection for this wallet address
    const usersRef = firestore.collection(FIREBASE_COLLECTION);
    
    // Search for documents where wallet field matches (case-insensitive)
    const snapshot = await usersRef
      .where('wallet', '==', normalizedAddress)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      // Also try searching with case-sensitive original address
      const snapshot2 = await usersRef
        .where('wallet', '==', walletAddress)
        .limit(1)
        .get();
      
      if (snapshot2.empty) {
        console.log(`❌ Wallet ${walletAddress} not found in Firestore users collection`);
        return false;
      }
    }
    
    console.log(`✅ Wallet ${walletAddress} found in Firestore users collection`);
    return true;
  } catch (error) {
    console.log('❌ Error checking Firestore:', error.message);
    // On error, allow the claim (fail-open for availability)
    return true;
  }
}

// Load or create claims file
function loadClaims() {
  if (fs.existsSync(CLAIMS_FILE)) {
    try {
      const data = fs.readFileSync(CLAIMS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
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
    // Create provider with static network to avoid ENS lookups
    provider = new ethers.JsonRpcProvider(RPC_ENDPOINT, {
      chainId: CHAIN_ID,
      name: 'bsc-mainnet',
      ensAddress: null
    }, {
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
    console.log('❌ Failed to initialize provider:', error.message);
    return false;
  }
}

// Validate Ethereum address
function isValidAddress(address) {
  try {
    if (!address || typeof address !== 'string') return false;
    // ethers v6 isAddress returns true for valid addresses
    const result = ethers.isAddress(address);
    console.log('Address validation:', { address, result, type: typeof address });
    return result;
  } catch (error) {
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
    network: 'BSC Mainnet',
    chainId: CHAIN_ID,
    faucetAmount: FAUCET_AMOUNT + ' BNB'
  });
});

// Get faucet info - Public endpoint (no auth needed)
app.get('/api/faucet/info', async (req, res) => {
  try {
    const balance = await provider.getBalance(adminWallet.address);
    
    res.json({
      success: true,
      data: {
        network: 'BSC Mainnet',
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

// Claim BNB endpoint - Protected with CORS (only iotrader.io) and rate limiting
app.post('/api/faucet/claim', limiter, async (req, res) => {
  try {
    let { address } = req.body;
    
    console.log('Received claim request:', { body: req.body, address });
    
    // Validate address
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }
    
    // Normalize and validate address (prevents ENS lookup)
    try {
      address = ethers.getAddress(address); // This validates and checksums the address
      console.log('Normalized address:', address);
    } catch (error) {
      console.log('Invalid address format:', address, error.message);
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address. Must be 42 characters (0x + 40 hex digits). Example: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      });
    }
    
    // Check if wallet exists in Firestore users collection
    const walletExists = await checkWalletInFirestore(address);
    if (!walletExists) {
      return res.status(403).json({
        success: false,
        error: 'Wallet address not found in registered users. Please register your wallet first on iotrader.io'
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
    
    // Check if recipient already has enough balance (use normalized address to avoid ENS)
    const recipientBalance = await provider.getBalance(address);
    if (recipientBalance > ethers.parseEther('0.1')) {
      return res.status(400).json({
        success: false,
        error: 'Your wallet already has sufficient balance. Faucet is for wallets with low balance only.'
      });
    }
    
    console.log(`\n💸 Processing claim for ${address}`);
    console.log(`Sending ${FAUCET_AMOUNT} BNB...`);
    
    // Send BNB (address already normalized above)
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
        explorerUrl: `https://bscscan.com/tx/${tx.hash}`
      },
      message: `Successfully sent ${FAUCET_AMOUNT} BNB to your wallet!`
    });
    
  } catch (error) {
    console.log('❌ Error processing claim:', error.message);
    
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
  console.log('🚀 Starting BNB Mainnet Faucet API...\n');
  
  const initialized = await initializeProvider();
  
  if (!initialized) {
    console.log('Failed to initialize. Please check your configuration.');
    process.exit(1);
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n✅ API Server Running!');
    console.log(`📡 Server: http://0.0.0.0:${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/health`);
    console.log(`💧 Faucet Info: http://localhost:${PORT}/api/faucet/info`);
    console.log(`\n💡 Endpoints:`);
    console.log(`   POST /api/faucet/claim - Claim ${FAUCET_AMOUNT} BNB`);
    console.log(`   GET  /api/faucet/status/:address - Check claim status`);
    console.log(`   GET  /api/faucet/info - Get faucet information`);
    console.log(`   GET  /api/faucet/claims - Get all claims history`);
    console.log(`   GET  /api/airdrop/list - Get airdrop eligible addresses`);
    console.log(`\n🔒 Security:`);
    console.log(`   CORS Protection: ✅ ENABLED`);
    console.log(`   Allowed Origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`   Firebase Firestore: ${firestore ? '✅ CONNECTED' : '⚠️  NOT CONNECTED'}`);
    console.log(`   Firestore Collection: ${FIREBASE_COLLECTION}`);
    console.log(`   Rate Limit: 5 claims per IP per hour`);
    console.log(`   Wallet Cooldown: 1 hour between claims`);
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
  console.log('💥 Fatal error:', error);
  process.exit(1);
});

