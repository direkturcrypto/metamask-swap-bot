const { ethers } = require('ethers');
const erc20Abi = require('./abi/erc20.json');
const wethAbi = require('./abi/weth.json');
const { fetchQuotes, pickBestQuote } = require('./quotes');
const { sleep, toUnits, fromUnits, formatEth, randomInt } = require('./utils');
const { estimateSwapPoints, caip19Erc20, caip19Native, getCurrentSeason } = require('./rewards');

async function validateEnvironment({ provider, routerAddress, chainId, usdc, weth }) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== Number(chainId)) throw new Error(`Provider chainId ${net.chainId} != expected ${chainId}`);
  const code = await provider.getCode(routerAddress);
  if (!code || code === '0x') throw new Error(`Router ${routerAddress} has no contract code on chain ${chainId}`);
  const codeUSDC = await provider.getCode(usdc);
  const codeWETH = await provider.getCode(weth);
  if (!codeUSDC || codeUSDC === '0x') throw new Error(`USDC address is not a contract: ${usdc}`);
  if (!codeWETH || codeWETH === '0x') throw new Error(`WETH address is not a contract: ${weth}`);
}

function getErc20(address, provider) {
  return new ethers.Contract(address, erc20Abi, provider);
}

function getWeth(address, signerOrProvider) {
  return new ethers.Contract(address, wethAbi, signerOrProvider);
}

async function getBalances({ address, provider, usdcAddress, wethAddress }) {
  const [ethWei, usdcWei, wethWei] = await Promise.all([
    provider.getBalance(address),
    getErc20(usdcAddress, provider).balanceOf(address),
    getErc20(wethAddress, provider).balanceOf(address)
  ]);
  return { ethWei, usdcWei, wethWei };
}

function logWalletHeader(address) {
  console.log(`\n🔄 Processing wallet ${address}`);
}

function ensureRouterSafety(quote, routerAddress) {
  const trade = (quote.trade || []).find(t => (t.title || '').toLowerCase() === 'trade');
  if (!trade) throw new Error('Quote has no trade step');
  const to = String(trade.txdata?.to || '').toLowerCase();
  if (to !== routerAddress.toLowerCase()) {
    throw new Error(`Unsafe router: expected ${routerAddress}, got ${trade.txdata?.to}`);
  }
}

async function maybeApproveIfNeeded({ signer, approvalStep, gasOverrides, config }) {
  if (!approvalStep) return null;
  const { txdata } = approvalStep;
  console.log('🧾 Sending approval tx...');
  const base = {
    to: txdata.to,
    data: txdata.data,
    value: txdata.value ? BigInt(txdata.value) : 0n
  };
  const est = await signer.estimateGas(base);
  const gasLimit = (est * 120n) / 100n; // +20%
  const tx = await signer.sendTransaction({ ...base, gasLimit, ...gasOverrides });
  console.log(`⏳ Approval sent: ${tx.hash}`);
  const rcpt = await tx.wait(2);
  console.log(`✅ Approval confirmed in block ${rcpt.blockNumber}`);
  return rcpt;
}

async function executeTrade({ signer, tradeStep, gasOverrides, config }) {
  const { txdata } = tradeStep;
  console.log('🚀 Sending trade tx...');
  const base = {
    to: txdata.to,
    data: txdata.data,
    value: txdata.value ? BigInt(txdata.value) : 0n
  };
  const est = await signer.estimateGas(base);
  const gasLimit = (est * 120n) / 100n; // +20%
  const tx = await signer.sendTransaction({ ...base, gasLimit, ...gasOverrides });
  console.log(`⏳ Trade sent: ${tx.hash}`);
  const rcpt = await tx.wait(2);
  console.log(`✅ Trade confirmed in block ${rcpt.blockNumber}`);
  return rcpt;
}

function isRetriableSwapError(err) {
  const msg = String(err?.reason || err?.shortMessage || err?.message || err || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('return amount is not enough') ||
    msg.includes('cannot estimate gas') ||
    msg.includes('always failing transaction') ||
    msg.includes('execution reverted')
  );
}

async function performSwap({
  provider,
  signer,
  address,
  direction, // 'ETH_TO_USDC' or 'USDC_TO_ETH'
  config,
  amountHuman, // numeric human amount to swap
  usdcDecimals = 6,
  ethDecimals = 18
}) {
  const { QUOTE_API_BASE, CHAIN_ID, SLIPPAGE, GAS_INCLUDED, RESET_APPROVAL, USDC_ADDRESS, WETH_ADDRESS, ROUTER_ADDRESS } = config;
  const srcToken = direction === 'ETH_TO_USDC' ? WETH_ADDRESS : USDC_ADDRESS;
  const destToken = direction === 'ETH_TO_USDC' ? USDC_ADDRESS : WETH_ADDRESS;
  const srcDecimals = direction === 'ETH_TO_USDC' ? ethDecimals : usdcDecimals;
  const srcAmountHuman = amountHuman; // amount decided by caller; no wrapping here

  // Determine amount to swap (already validated to be >= min earlier)
  const params = {
    apiBase: QUOTE_API_BASE,
    walletAddress: address,
    srcChainId: CHAIN_ID,
    destChainId: CHAIN_ID,
    srcToken,
    destToken,
    srcAmountHuman,
    srcDecimals,
    slippage: SLIPPAGE,
    insufficientBal: false,
    resetApproval: RESET_APPROVAL,
    gasIncluded: GAS_INCLUDED
  };

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔎 Fetching quotes for ${direction} amount ${srcAmountHuman}... (attempt ${attempt}/${maxAttempts})`);
    const quotes = await fetchQuotes(params);
    if (quotes.length === 0) {
      console.log('⚠️ No quotes returned');
      return false;
    }

    const best = pickBestQuote(quotes);
    try {
      ensureRouterSafety(best, ROUTER_ADDRESS);
      const steps = best.trade || [];
      const approval = steps.find(s => (s.title || '').toLowerCase() === 'approval');
      const trade = steps.find(s => (s.title || '').toLowerCase() === 'trade');
      if (!trade) throw new Error('Trade step missing in best quote');

      const gasOverrides = await buildGasOverrides(signer, config);

      // Rewards: print current points before swap
      try {
        if (config.REWARDS_SESSION_ID) {
          const season = await getCurrentSeason({ baseUrl: config.REWARDS_API_URL, clientId: config.REWARDS_CLIENT_ID, sessionId: config.REWARDS_SESSION_ID, language: config.REWARDS_LANGUAGE, debug: config.DEBUG, log: console.log });
          const pts = season?.balance?.total ?? season?.balance?.points ?? null;
          console.log(`🏆 Rewards session ok | Season: ${season?.season?.name || season?.season?.id || 'current'} | Points: ${pts ?? 'n/a'}`);
        }
      } catch (e) {
        console.log(`⚠️ Rewards pre-swap points check failed: ${e?.message || e}`);
      }

      // Rewards: estimate points before submitting
      try {
        const srcAssetId = direction === 'ETH_TO_USDC'
          ? caip19Native(config.CHAIN_ID)
          : caip19Erc20(config.CHAIN_ID, config.USDC_ADDRESS);
        const destAssetId = direction === 'ETH_TO_USDC'
          ? caip19Erc20(config.CHAIN_ID, config.USDC_ADDRESS)
          : caip19Native(config.CHAIN_ID);
        const feeAssetId = caip19Native(config.CHAIN_ID);
        const srcAmountBase = toUnits(srcAmountHuman, srcDecimals).toString();
        const destAmountBase = String(best?.quote?.destTokenAmount || '0');
        const est = await estimateSwapPoints({
          baseUrl: config.REWARDS_API_URL,
          clientId: config.REWARDS_CLIENT_ID,
          chainId: config.CHAIN_ID,
          address,
          srcAssetId,
          destAssetId,
          feeAssetId,
          srcAmount: srcAmountBase,
          destAmount: destAmountBase,
          feeAmount: '0',
          language: config.REWARDS_LANGUAGE,
          debug: config.DEBUG,
          log: console.log
        });
        console.log(`🎯 Estimated reward points: ${est?.pointsEstimate ?? 'n/a'} (bonus bips: ${est?.bonusBips ?? 0})`);
      } catch (e) {
        console.log(`⚠️ Rewards points estimation failed: ${e?.message || e}`);
      }
      // Submit approval first (if needed), then trade — one by one
      await maybeApproveIfNeeded({ signer, approvalStep: approval, gasOverrides, config });
      const rcpt = await executeTrade({ signer, tradeStep: trade, gasOverrides, config });

      // Rewards: print points after swap confirmed
      try {
        if (config.REWARDS_SESSION_ID) {
          const season2 = await getCurrentSeason({ baseUrl: config.REWARDS_API_URL, clientId: config.REWARDS_CLIENT_ID, sessionId: config.REWARDS_SESSION_ID, language: config.REWARDS_LANGUAGE, debug: config.DEBUG, log: console.log });
          const pts2 = season2?.balance?.total ?? season2?.balance?.points ?? null;
          console.log(`🏆 Rewards session ok | Season: ${season2?.season?.name || season2?.season?.id || 'current'} | Points: ${pts2 ?? 'n/a'}`);
        }
      } catch (e) {
        console.log(`⚠️ Rewards post-swap points check failed: ${e?.message || e}`);
      }

  // Do not unwrap after USDC->WETH; keep WETH balance as-is
      return true;
    } catch (err) {
      const msg = String(err?.reason || err?.shortMessage || err?.message || err);
      console.log(`❌ Swap attempt ${attempt} failed: ${msg}`);
      if (attempt < maxAttempts && isRetriableSwapError(err)) {
        const waitSec = 2 + randomInt(0, 3);
        console.log(`🔁 Retrying after ${waitSec}s with fresh quote...`);
        await sleep(waitSec * 1000);
        continue;
      }
      throw err;
    }
  }
  return false;
}

async function cycleWallet({ provider, wallet, config }) {
  const { address } = wallet;
  const signer = new ethers.Wallet(wallet.privateKey, provider);
  if (signer.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`PrivateKey does not match address for ${address}`);
  }
  logWalletHeader(address);

  // Balances
  const { ethWei, usdcWei, wethWei } = await getBalances({ address, provider, usdcAddress: config.USDC_ADDRESS, wethAddress: config.WETH_ADDRESS });
  console.log(`💰 ETH: ${formatEth(ethWei)} | WETH: ${formatEth(wethWei)} | USDC: ${fromUnits(usdcWei, 6)}`);

  const wethHuman = formatEth(wethWei);
  const usdcHuman = fromUnits(usdcWei, 6);

  // Pair cycle: WETH->USDC then USDC->WETH with random delay
  let didAny = false;

  if (wethHuman >= config.ETH_MIN_SWAP) {
    const amountWeth = wethHuman;
    if (amountWeth >= config.ETH_MIN_SWAP) {
      console.log(`🔁 Step 1: WETH->USDC amount ${amountWeth}`);
      await performSwap({ provider, signer, address, direction: 'ETH_TO_USDC', config, amountHuman: amountWeth });
      didAny = true;
      // Random delay before swapping back
      const delaySec = randomInt(config.DELAY_SECONDS_MIN, config.DELAY_SECONDS_MAX);
      console.log(`🕒 Waiting ${delaySec}s before swap back...`);
      await sleep(delaySec * 1000);

      // Refresh balances for the second leg
      const { usdcWei: usdcAfter } = await getBalances({ address, provider, usdcAddress: config.USDC_ADDRESS, wethAddress: config.WETH_ADDRESS });
      const usdcAfterHuman = fromUnits(usdcAfter, 6);
      if (usdcAfterHuman >= config.USDC_MIN_SWAP) {
        const amountUSDC = usdcAfterHuman;
        console.log(`🔁 Step 2: USDC->WETH amount ${amountUSDC}`);
        await performSwap({ provider, signer, address, direction: 'USDC_TO_ETH', config, amountHuman: amountUSDC });
        return;
      } else {
        console.log('ℹ️ After step 1, USDC below min; skipping swap back.');
        return;
      }
    }
  }

  // If cannot start with ETH->USDC, but USDC exists, do USDC->ETH single leg
  if (!didAny && usdcHuman >= config.USDC_MIN_SWAP) {
    const amountUSDC = usdcHuman;
    console.log(`🔁 Single: USDC->WETH amount ${amountUSDC}`);
    await performSwap({ provider, signer, address, direction: 'USDC_TO_ETH', config, amountHuman: amountUSDC });
    return;
  }

  console.log('ℹ️ No swap condition met for this cycle.');
}

async function buildGasOverrides(signer, config) {
  const ov = {};
  if (config.GAS_PRICE_MAX_GWEI !== undefined) {
    const cap = ethers.parseUnits(String(config.GAS_PRICE_MAX_GWEI), 'gwei');
    try {
      const fee = await signer.provider.getFeeData();
      const maxFee = fee.maxFeePerGas ?? cap;
      const maxPrio = fee.maxPriorityFeePerGas ?? cap;
      ov.maxFeePerGas = maxFee < cap ? maxFee : cap;
      ov.maxPriorityFeePerGas = maxPrio < cap ? maxPrio : cap;
    } catch (_) {
      // Fallback to cap for both in case provider doesn't support
      ov.maxFeePerGas = cap;
      ov.maxPriorityFeePerGas = cap;
    }
  }
  return ov;
}

module.exports = { validateEnvironment, cycleWallet };

async function wrapEth({ signer, wethAddress, amountWei, gasOverrides, config }) {
  const weth = getWeth(wethAddress, signer);
  const data = weth.interface.encodeFunctionData('deposit');
  const base = { to: wethAddress, data, value: amountWei };
  const est = await signer.estimateGas(base);
  const gasLimit = (est * 120n) / 100n;
  const tx = await signer.sendTransaction({ ...base, gasLimit, ...gasOverrides });
  console.log(`⏳ Wrap sent: ${tx.hash}`);
  const rcpt = await tx.wait(2);
  console.log(`✅ Wrap confirmed in block ${rcpt.blockNumber}`);
}

async function unwrapWeth({ signer, wethAddress, amountWei, gasOverrides, config }) {
  const weth = getWeth(wethAddress, signer);
  const data = weth.interface.encodeFunctionData('withdraw', [amountWei]);
  const base = { to: wethAddress, data };
  const est = await signer.estimateGas(base);
  const gasLimit = (est * 120n) / 100n;
  const tx = await signer.sendTransaction({ ...base, gasLimit, ...gasOverrides });
  console.log(`⏳ Unwrap sent: ${tx.hash}`);
  const rcpt = await tx.wait(2);
  console.log(`✅ Unwrap confirmed in block ${rcpt.blockNumber}`);
}
