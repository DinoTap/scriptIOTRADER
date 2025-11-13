# IOTrader Bot - Automated Trading Bot

Automated trading bot for IOTradingPlatform smart contract on BSC Testnet (Binance Smart Chain). This bot generates new wallets, funds them, and creates price prediction transactions at random intervals.

## Features

- 🔐 Automatic wallet generation
- 💰 Automatic funding from admin wallet
- 🎯 Random price predictions (ABOVE/BELOW)
- ⏰ Random interval execution (10-30 minutes)
- 💵 Random bet amounts (0.0001-0.0005 BNB per transaction)
- 📊 Support for multiple crypto symbols (BTC, ETH, MATIC, BNB, SOL, ADA, LINK)
- 📝 Transaction history logging
- 🔄 Continuous operation with graceful shutdown

## Smart Contract Details

- **Network:** BSC Testnet (Binance Smart Chain)
- **Chain ID:** 97
- **Contract Address:** `0x0aBa6b5E62153B922305Fd910309eF09CD8A7c08`
- **Explorer:** [View on BscScan](https://testnet.bscscan.com/address/0x0aBa6b5E62153B922305Fd910309eF09CD8A7c08)

## Prerequisites

- Node.js v18+ installed
- Admin wallet with BSC testnet BNB
- Private key of admin wallet

## Getting Testnet BNB

To get free testnet BNB for BSC:
1. Visit [Binance Testnet Faucet](https://testnet.bnbchain.org/faucet-smart)
2. Enter your wallet address
3. Complete the verification
4. Request testnet BNB (you can also use [BNB Chain Discord](https://discord.com/channels/789402563035660308/912296662834241597) for faucet requests)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from template:
```bash
cp .env.example .env
```

4. Edit `.env` file and add your admin wallet private key:
```env
ADMIN_PRIVATE_KEY=your_actual_private_key_here
FUNDING_AMOUNT=0.1
PREDICTION_AMOUNT=0.01
```

⚠️ **IMPORTANT:** Never share your private key or commit the `.env` file to version control!

## Configuration

You can customize the bot behavior by editing the `.env` file:

- `ADMIN_PRIVATE_KEY` - Private key of wallet with funds (REQUIRED)
- `RPC_URL` - Custom RPC endpoint (optional, defaults to BSC Testnet RPC)
- `FUNDING_AMOUNT` - Amount of BNB to send to each new wallet (default: 0.1)
- `PREDICTION_AMOUNT` - Amount of BNB to use for each prediction (default: 0.01)

## Usage

### Start the Bot

```bash
npm start
```

The bot will:
1. Generate a new random wallet
2. Fund it from the admin wallet (0.1 BNB by default)
3. Create a price prediction transaction (random 0.0001-0.0005 BNB)
4. Wait for a random interval (10-30 minutes)
5. Repeat the process

### Stop the Bot

Press `Ctrl+C` to gracefully shutdown the bot. All wallet data will be saved to `wallets.json`.

### Test Individual Components

Test wallet generation and funding without creating predictions:

```bash
node test.js
```

## How It Works

### Wallet Generation
- Creates a new Ethereum wallet with random private key
- Stores wallet information in `wallets.json`

### Funding
- Transfers BNB from admin wallet to newly generated wallet
- Default: 0.1 BNB per wallet
- Includes gas fee buffer

### Price Predictions
- Randomly selects a crypto symbol (BTC, ETH, MATIC, etc.)
- Generates random entry and target prices
- Randomly chooses direction (ABOVE/BELOW)
- Uses random leverage (1x to 5x)
- Sets random duration (1 hour to 1 day)
- Creates transaction with smart contract

### Example Prediction
```
Symbol: BTC
Entry Price: $45,000
Target Price: $50,000
Direction: 📈 ABOVE
Leverage: 3x
Duration: 12h
Bet Amount: 0.01 BNB
```

## File Structure

```
scriptIOTRADER/
├── index.js              # Main bot script
├── test.js               # Testing utilities
├── contract-config.js    # Contract ABI and configuration
├── package.json          # Node.js dependencies
├── .env                  # Environment variables (create from template)
├── env-template.txt      # Template for .env file
├── wallets.json         # Generated wallets log (auto-created)
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

## Output Example

```
🤖 IOTrader Bot Starting...
Network: BSC Testnet (Binance Smart Chain)
Chain ID: 97
Contract: 0x0aBa6b5E62153B922305Fd910309eF09CD8A7c08

============================================================
🔄 Transaction Cycle #1
Time: 11/13/2025, 10:30:00 AM
============================================================

🔐 New Wallet Generated:
Address: 0x1234...5678
Private Key: 0xabcd...ef12

💰 Funding new wallet...
Admin Balance: 5.5 BNB
Funding transaction sent: 0x9876...4321
✅ Funding successful! Block: 12345678
New Wallet Balance: 0.1 BNB

🎯 Creating Price Prediction...
Wallet Balance: 0.1 BNB

📊 Prediction Parameters:
Symbol: BTC
Entry Price: $45000
Target Price: $50000
Direction: 📈 ABOVE
Leverage: 3x
Duration: 43200s (12h)
Bet Amount: 0.01 BNB

📤 Transaction sent: 0xdef1...9abc
✅ Prediction created successfully!
Block: 12345679
Prediction ID: 42

✅ Cycle completed successfully!
Total transactions: 1

⏰ Next transaction scheduled in 1 minutes
Next run at: 11/13/2025, 10:31:00 AM
```

## Transaction History

All generated wallets and their transactions are stored in `wallets.json`:

```json
{
  "wallets": [
    {
      "address": "0x1234...5678",
      "privateKey": "0xabcd...ef12",
      "createdAt": "2025-11-13T10:30:00.000Z",
      "transactions": [
        {
          "hash": "0xdef1...9abc",
          "blockNumber": 12345679,
          "symbol": "BTC",
          "entryPrice": 45000,
          "targetPrice": 50000,
          "isAbove": true,
          "leverage": 3,
          "duration": 43200,
          "amount": "0.01",
          "timestamp": "2025-11-13T10:30:15.000Z"
        }
      ]
    }
  ]
}
```

## Troubleshooting

### "Insufficient admin wallet balance"
- Ensure your admin wallet has enough BNB
- Get testnet BNB from Binance Testnet Faucet

### "Wrong network" error
- Verify you're connecting to BSC Testnet
- Check RPC URL in `.env` or `contract-config.js`

### "Failed to connect to network"
- Check your internet connection
- Try a different RPC endpoint in your `.env` file:
  - `https://bsc-testnet-rpc.publicnode.com` (default)
  - `https://rpc.ankr.com/bsc_testnet_chapel`
  - `https://bsc-testnet.drpc.org`
- Verify the RPC URL is correct

### Transaction fails
- Ensure new wallet has enough balance
- Check if contract is still active
- Verify gas prices are reasonable

## Security Notes

⚠️ **IMPORTANT SECURITY WARNINGS:**

1. **Never share your private keys**
2. **Never commit `.env` file to git** (already in `.gitignore`)
3. **This is for TESTNET only** - Do not use with mainnet wallets
4. **Keep `wallets.json` secure** - Contains private keys of generated wallets
5. **Use separate admin wallet** - Don't use your main wallet as admin

## Support

For issues with:
- **Smart Contract:** Check contract on [BscScan Testnet](https://testnet.bscscan.com/address/0x0aBa6b5E62153B922305Fd910309eF09CD8A7c08)
- **Network:** Verify on [BNB Chain Status](https://www.bnbchain.org/en/status)
- **Testnet Faucet:** Use [Binance Testnet Faucet](https://testnet.bnbchain.org/faucet-smart)

## License

MIT License - Feel free to modify and use as needed.

