import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatEther } from "viem";

/**
 * Script to generate four new wallet addresses with private keys
 * These can be used to replace WALLET1_PRIVATE_KEY through WALLET4_PRIVATE_KEY in .env
 */
function generateWallets() {
  console.log("=".repeat(60));
  console.log("Generating Four New Wallet Addresses");
  console.log("=".repeat(60));
  console.log();

  const wallets = [];
  for (let i = 0; i < 4; i++) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    wallets.push({
      address: account.address,
      privateKey,
    });
    console.log(`Wallet ${i + 1}:`);
    console.log(`  Address: ${account.address}`);
    console.log(`  Private Key: ${privateKey}`);
    console.log();
  }

  console.log("=".repeat(60));
  console.log("Add these to your .env file:");
  console.log("=".repeat(60));
  console.log();
  wallets.forEach((w, i) => {
    console.log(`WALLET${i + 1}_PRIVATE_KEY=${w.privateKey}`);
  });
  console.log();

  return {
    wallet1: wallets[0],
    wallet2: wallets[1],
    wallet3: wallets[2],
    wallet4: wallets[3],
  };
}

// Run the generator
const wallets = generateWallets();

// Optionally save to a file (commented out by default for security)
// Uncomment if you want to save to a file (not recommended for production)
/*
import { writeFileSync } from "fs";
writeFileSync("generated-wallets.json", JSON.stringify(wallets, null, 2));
console.log("Wallets saved to generated-wallets.json");
*/
