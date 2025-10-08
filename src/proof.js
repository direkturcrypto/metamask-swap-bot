const axios = require('axios');

async function submitProof({ apiBase, txhash, chainId, timeoutMs = 30000 }) {
  if (!apiBase) throw new Error('submit-proof: missing apiBase');
  if (!txhash) throw new Error('submit-proof: missing txhash');
  if (!chainId) throw new Error('submit-proof: missing chainId');

  const url = `${apiBase.replace(/\/$/, '')}/submit-proof`;
  const body = { txhash, chainId: Number(chainId) };
  const { data } = await axios.post(url, body, { timeout: timeoutMs });
  return data;
}

module.exports = { submitProof };

