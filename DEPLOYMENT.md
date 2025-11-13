# Deployment Guide

This project can run both the API server (faucet) and the trading bot simultaneously.

## 🚀 Quick Start (Local)

### Run Everything Together
```bash
npm install
npm start
```

This will start:
- ✅ API Server on `http://localhost:3000`
- ✅ Trading Bot (creates transactions every 10-30 mins)

### Run Separately (Development)
```bash
# Terminal 1 - API Server only
npm run api

# Terminal 2 - Bot only
npm run bot
```

## 🚄 Railway Deployment

### Option 1: Single Service (Recommended - Runs Both)

1. **Create New Project on Railway**
   - Go to [Railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"

2. **Set Environment Variables**
   - Go to your service → Variables tab
   - Add these variables:

   ```
   ADMIN_PRIVATE_KEY=your_private_key_here
   RPC_URL=https://rpc.ankr.com/bsc_testnet_chapel
   FAUCET_AMOUNT=0.005
   FUNDING_AMOUNT=0.1
   PREDICTION_AMOUNT=0.01
   ```

3. **Deploy**
   - Railway will automatically detect the `Procfile`
   - It will run `npm start` which starts both services
   - Your API will be available at: `https://your-app.up.railway.app`

### Option 2: Separate Services (Advanced)

Deploy as two separate Railway services:

#### Service 1: API Server
- **Start Command:** `node api-server.js`
- **Environment Variables:** `ADMIN_PRIVATE_KEY`, `FAUCET_AMOUNT`
- **Public:** Yes (Generate domain)

#### Service 2: Bot
- **Start Command:** `node index.js`
- **Environment Variables:** `ADMIN_PRIVATE_KEY`, `FUNDING_AMOUNT`, `PREDICTION_AMOUNT`
- **Public:** No (Background worker)

## 📝 Required Environment Variables

### Essential
```bash
ADMIN_PRIVATE_KEY=0xYourPrivateKey  # REQUIRED - Wallet with testnet BNB
```

### Optional (with defaults)
```bash
RPC_URL=https://rpc.ankr.com/bsc_testnet_chapel
API_PORT=3000
FAUCET_AMOUNT=0.005
FUNDING_AMOUNT=0.1
PREDICTION_AMOUNT=0.01
```

## 🧪 Testing Your Deployment

### Test API Health
```bash
curl https://your-app.up.railway.app/health
```

### Test Faucet Claim
```bash
curl -X POST https://your-app.up.railway.app/api/faucet/claim \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourWalletAddress"}'
```

### Check Airdrop List
```bash
curl https://your-app.up.railway.app/api/airdrop/list
```

## 📊 What Runs When You Start

### API Server (`api-server.js`)
- REST API for faucet claims
- Listens on port 3000 (or `PORT` env var)
- Endpoints:
  - `POST /api/faucet/claim` - Claim 0.005 BNB
  - `GET /api/faucet/info` - Faucet information
  - `GET /api/faucet/status/:address` - Check eligibility
  - `GET /api/faucet/claims` - All claims history
  - `GET /api/airdrop/list` - Airdrop addresses

### Trading Bot (`index.js`)
- Runs in background
- Creates new wallet every 10-30 minutes
- Funds wallet with BNB
- Makes random price prediction (0.0001-0.0005 BNB)
- Saves all data to `wallets.json`
- Claims saved to `faucet-claims.json`

## 🔒 Security Notes

⚠️ **IMPORTANT:**
- Never commit `.env` file or private keys to Git
- Use dedicated testnet wallet (not your main wallet)
- Monitor your admin wallet balance
- Both services use the same admin wallet for funding

## 📱 Frontend Integration

Use these endpoints in your frontend:

```javascript
// Check if user can claim
const response = await fetch(
  `https://your-app.up.railway.app/api/faucet/status/${userAddress}`
);

// Claim BNB
const response = await fetch(
  'https://your-app.up.railway.app/api/faucet/claim',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: userAddress })
  }
);
```

## 🔍 Monitoring

### View Logs on Railway
1. Go to your service
2. Click "Deployments"
3. Select latest deployment
4. View real-time logs

### Check Claims
```bash
curl https://your-app.up.railway.app/api/faucet/claims
```

### Check Bot Activity
- Logs show each transaction cycle
- Check `wallets.json` in Railway filesystem
- Monitor transactions on [BSCScan Testnet](https://testnet.bscscan.com)

## 🛠️ Troubleshooting

### API not responding
- Check Railway logs for errors
- Verify `ADMIN_PRIVATE_KEY` is set
- Test RPC connection

### Bot not creating transactions
- Ensure admin wallet has testnet BNB
- Check Railway logs for errors
- Verify network connectivity

### "Insufficient balance" errors
- Admin wallet needs more testnet BNB
- Get free BNB from: https://testnet.bnbchain.org/faucet-smart

## 📞 Support

For issues:
- Check Railway logs
- Verify environment variables
- Test RPC endpoint manually
- Check admin wallet balance on [BSCScan](https://testnet.bscscan.com)

