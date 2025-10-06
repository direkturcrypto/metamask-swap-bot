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
  TX_SUBMIT_BASE,
  STX_CONTROLLER_VERSION,
  DEBUG,
  REWARDS_API_URL,
  REWARDS_CLIENT_ID,
  REWARDS_LANGUAGE,
  REWARDS_REFERRAL_CODE,
  REWARDS_SESSIONS_PATH,
  loadWallets
} = require('./config');
const { validateEnvironment, cycleWallet } = require('./swapper');
const { ensureSession, getCurrentSeason } = require('./rewards');
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
    TX_SUBMIT_BASE,
    STX_CONTROLLER_VERSION,
    DEBUG,
    REWARDS_API_URL,
    REWARDS_CLIENT_ID,
    USDC_ADDRESS,
    WETH_ADDRESS
  });

  while (true) {
    console.log('\n================ CYCLE START ================');
    for (const w of wallets) {
      try {
        // Rewards: ensure session and show current points
        const signer = new ethers.Wallet(w.privateKey, provider);
        const { sessionId } = await ensureSession({
          baseUrl: REWARDS_API_URL,
          clientId: REWARDS_CLIENT_ID,
          sessionsPath: REWARDS_SESSIONS_PATH,
          signer,
          address: w.address,
          referralCode: REWARDS_REFERRAL_CODE,
          language: REWARDS_LANGUAGE,
          debug: DEBUG
        });
        const season = await getCurrentSeason({ baseUrl: REWARDS_API_URL, clientId: REWARDS_CLIENT_ID, sessionId, language: REWARDS_LANGUAGE, debug: DEBUG });
        const points = season?.balance?.total ?? season?.balance?.points ?? null;
        console.log(`🏆 Rewards session ok | Season: ${season?.season?.name || season?.season?.id || 'current'} | Points: ${points ?? 'n/a'}`);

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
          DELAY_SECONDS_MAX,
          TX_SUBMIT_BASE,
          STX_CONTROLLER_VERSION,
          DEBUG,
          REWARDS_API_URL,
          REWARDS_CLIENT_ID,
          REWARDS_LANGUAGE,
          REWARDS_SESSION_ID: sessionId
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
