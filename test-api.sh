#!/bin/bash

# Test API Script
API_URL="http://localhost:8080"
TEST_WALLET="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"

echo "🧪 Testing IOTrader Faucet API"
echo "================================"
echo ""

echo "1️⃣  Testing Health Check..."
curl -s $API_URL/health | jq '.' || curl -s $API_URL/health
echo -e "\n"

echo "2️⃣  Testing Faucet Info..."
curl -s $API_URL/api/faucet/info | jq '.' || curl -s $API_URL/api/faucet/info
echo -e "\n"

echo "3️⃣  Testing Claim Status..."
curl -s $API_URL/api/faucet/status/$TEST_WALLET | jq '.' || curl -s $API_URL/api/faucet/status/$TEST_WALLET
echo -e "\n"

echo "4️⃣  Testing Claim BNB..."
curl -s -X POST $API_URL/api/faucet/claim \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$TEST_WALLET\"}" | jq '.' || \
curl -s -X POST $API_URL/api/faucet/claim \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$TEST_WALLET\"}"
echo -e "\n"

echo "5️⃣  Testing Airdrop List..."
curl -s $API_URL/api/airdrop/list | jq '.data.totalAddresses' || curl -s $API_URL/api/airdrop/list | head -20
echo -e "\n"

echo "✅ Test Complete!"

