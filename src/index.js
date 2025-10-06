const { ethers } = require('ethers');
const {
  CHAIN_ID,
  RPC_URL,
  QUOTE_API_BASE,
  SLIPPAGE,
  GAS_INCLUDED,
  RESET_APPROVAL,
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
  USDC_MIN_SWAP,
  ETH_MIN_SWAP,
  GAS_PRICE_MAX_GWEI,
  DELAY_SECONDS_MIN,
  DELAY_SECONDS_MAX,
  loadWallets
} = require('./config');
const { validateEnvironment, cycleWallet } = require('./swapper');
const { sleep } = require('./utils');

async function main() {
  console.log('🟢 MetaMask Swap Loop starting...');
  console.log(`🔧 Chain: ${CHAIN_ID} | Router: ${ROUTER_ADDRESS}`);
  console.log(`🌐 RPC: ${RPC_URL}`);
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

  // Validate environment (router, tokens, chain)
  await validateEnvironment({
    provider,
    routerAddress: ROUTER_ADDRESS,
    chainId: CHAIN_ID,
    usdc: USDC_ADDRESS,
    weth: WETH_ADDRESS
  });
  console.log('🔒 Router & token addresses validated.');

  const wallets = loadWallets();
  if (wallets.length === 0) {
    console.log('⚠️ No wallets in wallets.json');
    return;
  }
  console.log(`👛 Loaded ${wallets.length} wallet(s).`);

  // Show config summary
  console.log('⚙️ Config:');
  console.log({
    CHAIN_ID,
    SLIPPAGE,
    GAS_INCLUDED,
    RESET_APPROVAL,
    ROUTER_ADDRESS,
    USDC_MIN_SWAP,
    ETH_MIN_SWAP,
    GAS_PRICE_MAX_GWEI,
    DELAY_SECONDS_MIN,
    DELAY_SECONDS_MAX,
    USDC_ADDRESS,
    WETH_ADDRESS
  });

  while (true) {
    console.log('\n================ CYCLE START ================');
    for (const w of wallets) {
      try {
        await cycleWallet({ provider, wallet: w, config: {
          CHAIN_ID,
          QUOTE_API_BASE,
          SLIPPAGE,
          GAS_INCLUDED,
          RESET_APPROVAL,
          ROUTER_ADDRESS,
          USDC_ADDRESS,
          WETH_ADDRESS,
          USDC_MIN_SWAP,
          ETH_MIN_SWAP,
          GAS_PRICE_MAX_GWEI,
          DELAY_SECONDS_MIN,
          DELAY_SECONDS_MAX
        }});
      } catch (err) {
        console.error(`❌ Wallet ${w.address} error:`, err.message || err);
      }
    }
    console.log('🕒 Waiting 60s before next cycle...');
    await sleep(60_000);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
