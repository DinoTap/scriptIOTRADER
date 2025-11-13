# Railway Environment Variables Configuration

When deploying to Railway, set these environment variables in your Railway project settings.

## 🚀 Single Deployment (Both API + Bot)

The default `npm start` command runs BOTH services together:
- API Server (port 3000)
- Trading Bot (background)

## Required Environment Variables

### For API Server (Faucet)

```
ADMIN_PRIVATE_KEY=your_admin_wallet_private_key_here
```

### Optional Environment Variables

```bash
# RPC URL (optional, defaults to Ankr)
RPC_URL=https://rpc.ankr.com/bsc_testnet_chapel

# API Server Port (Railway sets PORT automatically)
API_PORT=3000

# Faucet amount per claim (in BNB)
FAUCET_AMOUNT=0.005

# Bot Configuration (if running bot service)
FUNDING_AMOUNT=0.1
PREDICTION_AMOUNT=0.01
```

## How to Set Environment Variables on Railway

1. Go to your Railway project dashboard
2. Click on your service
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Add each environment variable

### Required Variable:
- **Variable Name:** `ADMIN_PRIVATE_KEY`
- **Value:** Your wallet's private key (the one with testnet BNB)

## Railway Deployment Services

You can deploy two separate services:

### 1. API Server (Faucet Service)
- **Start Command:** `node api-server.js`
- **Description:** REST API for users to claim testnet BNB
- **Public:** Yes (needs to be accessible from frontend)

### 2. Bot Service (Optional)
- **Start Command:** `node index.js`
- **Description:** Automated trading bot that runs continuously
- **Public:** No (background service)

## Important Notes

⚠️ **SECURITY:**
- Never commit your `ADMIN_PRIVATE_KEY` to Git
- Only set sensitive variables in Railway's environment settings
- Use a dedicated testnet wallet (not your main wallet)

## Railway Deployment URLs

After deployment, your API will be available at:
```
https://your-project-name.up.railway.app
```

### API Endpoints:
- `GET /health` - Check if API is running
- `POST /api/faucet/claim` - Claim testnet BNB
- `GET /api/faucet/info` - Get faucet information
- `GET /api/faucet/status/:address` - Check claim eligibility
- `GET /api/faucet/claims` - View all claims (for admin)
- `GET /api/airdrop/list` - Get airdrop eligible addresses

## Testing Your Deployment

Once deployed, test with:

```bash
# Check health
curl https://your-project-name.up.railway.app/health

# Get faucet info
curl https://your-project-name.up.railway.app/api/faucet/info

# Claim BNB (replace with your address)
curl -X POST https://your-project-name.up.railway.app/api/faucet/claim \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourWalletAddress"}'
```

