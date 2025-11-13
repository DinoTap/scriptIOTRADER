import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { CONTRACT_ADDRESS, CONTRACT_ABI, CHAIN_ID, RPC_URL } from './contract-config.js';

dotenv.config();

const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const RPC_ENDPOINT = process.env.RPC_URL || RPC_URL;

async function testConnection() {
  console.log('🧪 Testing Connection...\n');
  console.log('RPC Endpoint:', RPC_ENDPOINT);
  
  try {
    const provider = new ethers.JsonRpcProvider(RPC_ENDPOINT, undefined, {
      staticNetwork: true,
      batchMaxCount: 1
    });
    const network = await provider.getNetwork();
    
    console.log('✅ Network connected:', network.name);
    console.log('Chain ID:', network.chainId.toString());
    
    if (network.chainId !== BigInt(CHAIN_ID)) {
      console.error(`❌ Wrong network! Expected ${CHAIN_ID}, got ${network.chainId}`);
      return false;
    }
    
    return provider;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    return false;
  }
}

async function testAdminWallet(provider) {
  console.log('\n🧪 Testing Admin Wallet...\n');
  
  if (!ADMIN_PRIVATE_KEY || ADMIN_PRIVATE_KEY === 'your_admin_wallet_private_key_here') {
    console.error('❌ Please set ADMIN_PRIVATE_KEY in .env file');
    return false;
  }
  
  try {
    const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    const balance = await provider.getBalance(adminWallet.address);
    
    console.log('✅ Admin Wallet Address:', adminWallet.address);
    console.log('Balance:', ethers.formatEther(balance), 'BNB');
    
    if (balance === 0n) {
      console.warn('⚠️ Warning: Admin wallet has no balance!');
      console.log('Get testnet BNB from: https://testnet.bnbchain.org/faucet-smart');
      return false;
    }
    
    return adminWallet;
  } catch (error) {
    console.error('❌ Admin wallet error:', error.message);
    return false;
  }
}

async function testContract(provider) {
  console.log('\n🧪 Testing Smart Contract...\n');
  
  try {
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    
    console.log('Contract Address:', CONTRACT_ADDRESS);
    
    // Try to read some public data
    try {
      const owner = await contract.owner();
      console.log('✅ Contract Owner:', owner);
    } catch (e) {
      console.log('Note: Could not read owner (might not be accessible)');
    }
    
    try {
      const stats = await contract.getPlatformStats();
      console.log('\n📊 Platform Stats:');
      console.log('Total Predictions:', stats.totalPredictions.toString());
      console.log('Total Markets:', stats.totalMarkets.toString());
      console.log('Total Future Positions:', stats.totalFuturePos.toString());
      console.log('Volume Traded:', ethers.formatEther(stats.volumeTraded), 'BNB');
      console.log('Fees Collected:', ethers.formatEther(stats.feesCollected), 'BNB');
    } catch (e) {
      console.log('Note: Could not read platform stats:', e.message);
    }
    
    return contract;
  } catch (error) {
    console.error('❌ Contract error:', error.message);
    return false;
  }
}

async function testWalletGeneration() {
  console.log('\n🧪 Testing Wallet Generation...\n');
  
  try {
    const wallet = ethers.Wallet.createRandom();
    console.log('✅ New Wallet Generated:');
    console.log('Address:', wallet.address);
    console.log('Private Key:', wallet.privateKey);
    console.log('Mnemonic:', wallet.mnemonic.phrase);
    
    return wallet;
  } catch (error) {
    console.error('❌ Wallet generation error:', error.message);
    return false;
  }
}

async function testFunding(provider, adminWallet) {
  console.log('\n🧪 Testing Wallet Funding...\n');
  
  try {
    // Generate a test wallet
    const testWallet = ethers.Wallet.createRandom();
    console.log('Test Wallet Address:', testWallet.address);
    
    // Check if admin has enough balance
    const adminBalance = await provider.getBalance(adminWallet.address);
    const fundingAmount = ethers.parseEther('0.01'); // Small test amount
    
    if (adminBalance < fundingAmount) {
      console.error('❌ Insufficient admin balance for test');
      return false;
    }
    
    console.log('\nSending 0.01 BNB to test wallet...');
    
    const tx = await adminWallet.sendTransaction({
      to: testWallet.address,
      value: fundingAmount
    });
    
    console.log('Transaction Hash:', tx.hash);
    console.log('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed! Block:', receipt.blockNumber);
    
    // Check new balance
    const newBalance = await provider.getBalance(testWallet.address);
    console.log('Test Wallet Balance:', ethers.formatEther(newBalance), 'BNB');
    
    return true;
  } catch (error) {
    console.error('❌ Funding test error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 IOTrader Bot - System Tests\n');
  console.log('='.repeat(60));
  
  // Test 1: Connection
  const provider = await testConnection();
  if (!provider) {
    console.log('\n❌ Tests failed at connection step');
    return;
  }
  
  // Test 2: Admin Wallet
  const adminWallet = await testAdminWallet(provider);
  if (!adminWallet) {
    console.log('\n❌ Tests failed at admin wallet step');
    return;
  }
  
  // Test 3: Contract
  const contract = await testContract(provider);
  if (!contract) {
    console.log('\n⚠️ Contract test had issues (contract might still work)');
  }
  
  // Test 4: Wallet Generation
  const newWallet = await testWalletGeneration();
  if (!newWallet) {
    console.log('\n❌ Tests failed at wallet generation step');
    return;
  }
  
  // Test 5: Funding (optional, uncomment to test)
  console.log('\n⚠️ Skipping funding test (uncomment to enable)');
  // Uncomment the line below to test actual funding
  // await testFunding(provider, adminWallet);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All critical tests passed!');
  console.log('\nYou can now run the bot with: npm start');
  console.log('\n💡 Tips:');
  console.log('- Make sure your admin wallet has enough BNB');
  console.log('- Get testnet BNB from: https://testnet.bnbchain.org/faucet-smart');
  console.log('- Monitor transactions on: https://testnet.bscscan.com/');
}

// Run tests
runTests().catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});

