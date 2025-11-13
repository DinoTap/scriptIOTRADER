import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting IOTrader Platform...\n');
console.log('='.repeat(60));
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Port: ${process.env.PORT || 8080}\n`);

// Start API Server
console.log('📡 Starting API Server (Faucet Service)...');
const apiServer = spawn('node', ['api-server.js'], {
  stdio: 'inherit',
  cwd: __dirname,
  env: { ...process.env }
});

// Wait a bit before starting the bot
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 Starting Trading Bot...\n');
  
  const bot = spawn('node', ['index.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env: { ...process.env }
  });

  bot.on('error', (error) => {
    console.error('❌ Bot Error:', error);
  });

  bot.on('exit', (code, signal) => {
    if (code !== 0) {
      console.log(`⚠️ Bot exited with code ${code}`);
    }
  });
}, 5000); // Wait 5 seconds for API to initialize

apiServer.on('error', (error) => {
  console.error('❌ API Server Error:', error);
});

apiServer.on('exit', (code, signal) => {
  if (code !== 0) {
    console.log(`⚠️ API Server exited with code ${code}`);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down all services...');
  apiServer.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down all services...');
  apiServer.kill('SIGTERM');
  process.exit(0);
});

