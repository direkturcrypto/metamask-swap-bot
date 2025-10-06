const axios = require('axios');
const { toUnits } = require('./utils');

async function fetchQuotes({
  apiBase,
  walletAddress,
  srcChainId,
  destChainId,
  srcToken,
  destToken,
  srcAmountHuman,
  srcDecimals,
  slippage,
  insufficientBal,
  resetApproval,
  gasIncluded
}) {
  const params = {
    walletAddress,
    destWalletAddress: walletAddress,
    srcChainId,
    destChainId,
    srcTokenAddress: srcToken,
    destTokenAddress: destToken,
    srcTokenAmount: toUnits(srcAmountHuman, srcDecimals).toString(),
    insufficientBal: Boolean(insufficientBal),
    resetApproval: Boolean(resetApproval),
    gasIncluded: Boolean(gasIncluded),
    slippage: Number(slippage)
  };

  const url = `${apiBase}/fetch-quotes`;
  const { data } = await axios.get(url, { params, timeout: 60_000 });
  if (!Array.isArray(data) || data.length === 0) return [];
  return data;
}

function pickBestQuote(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;
  // Choose by highest destTokenAmount
  const sorted = [...quotes].sort((a, b) => {
    const da = BigInt(a.quote?.destTokenAmount || '0');
    const db = BigInt(b.quote?.destTokenAmount || '0');
    return db > da ? 1 : db < da ? -1 : 0;
  });
  return sorted[0];
}

module.exports = { fetchQuotes, pickBestQuote };

