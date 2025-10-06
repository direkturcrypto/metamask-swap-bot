const axios = require('axios');
const { ethers } = require('ethers');

async function buildSignedRawTx(signer, baseRequest, gasOverrides = {}, { debug = false, log = console.log, fallbackGasLimit } = {}) {
  // Estimate gas and add a 20% buffer like existing flow. If estimate fails, use fallbackGasLimit if provided.
  let gasLimit;
  try {
    const est = await signer.estimateGas(baseRequest);
    gasLimit = (est * 120n) / 100n;
  } catch (e) {
    if (fallbackGasLimit) {
      gasLimit = BigInt(fallbackGasLimit);
      if (debug) log(`⚠️ estimateGas failed (${e?.shortMessage || e?.message || e}); using fallback gasLimit=${String(gasLimit)}`);
    } else {
      throw e;
    }
  }

  // Populate the rest (nonce, chainId, type, fee fields) via provider
  const populated = await signer.populateTransaction({
    ...baseRequest,
    gasLimit,
    type: 2,
    ...gasOverrides
  });
  if (debug) {
    const val = baseRequest.value ? String(baseRequest.value) : '0';
    log(`🧱 Tx build: to=${baseRequest.to} valueWei=${val} dataLen=${(baseRequest.data||'').length} gasLimit=${String(populated.gasLimit||gasLimit)}`);
    log(`🧱 Tx fees: maxFeePerGas=${String(populated.maxFeePerGas||'')} maxPriorityFeePerGas=${String(populated.maxPriorityFeePerGas||'')} nonce=${String(populated.nonce||'')}`);
  }
  const signed = await signer.signTransaction(populated);
  return { raw: signed, populated };
}

async function submitViaMetaMaskApi({ chainId, apiBase, controllerVersion }, rawTx, { debug = false, log = console.log } = {}) {
  const submitUrl = `${apiBase}/networks/${chainId}/submitTransactions`;
  const params = { stxControllerVersion: controllerVersion };
  if (debug) log(`🌐 POST ${submitUrl}?stxControllerVersion=${controllerVersion} rawTxs=1`);
  let data;
  try {
    const payload = { rawTxs: [rawTx], rawCancelTxs: [] };
    if (debug) log(`🧾 Submit payload: ${JSON.stringify(payload)}`);
    ({ data } = await axios.post(submitUrl, payload, { params, timeout: 60_000 }));
    if (debug) log(`✅ Submit response: ${JSON.stringify(data)}`);
  } catch (e) {
    const status = e?.response?.status;
    const body = e?.response?.data;
    if (debug) log(`❌ Submit error status=${status} body=${JSON.stringify(body)}`);
    throw e;
  }
  const uuid = data?.uuid;
  if (!uuid) throw new Error('MetaMask submit: missing uuid');
  return uuid;
}

async function pollBatchStatus({ chainId, apiBase }, uuid, { timeoutMs = 120_000, intervalMs = 1500, debug = false, log = console.log } = {}) {
  const statusUrl = `${apiBase}/networks/${chainId}/batchStatus`;
  const start = Date.now();
  let it = 0;
  while (Date.now() - start < timeoutMs) {
    let data;
    try {
      ({ data } = await axios.get(statusUrl, { params: { uuids: uuid }, timeout: 30_000 }));
    } catch (e) {
      if (debug) log(`❌ Poll error: ${e?.message}`);
      throw e;
    }
    const entry = data?.[uuid];
    if (debug) {
      it++;
      log(`⏱️  Poll #${it}: isSettled=${entry?.isSettled} minedTx=${entry?.minedTx} minedHash=${entry?.minedHash || ''}`);
    }
    if (entry?.isSettled) {
      if (entry.minedTx === 'success' && entry.minedHash) return entry.minedHash;
      const reason = entry?.wouldRevertMessage || entry?.cancellationReason || 'failed';
      throw new Error(`MetaMask batch failed: ${reason}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('MetaMask batch did not settle in time');
}

async function signAndSubmitMetaMask({ signer, baseRequest, gasOverrides, chainId, apiBase, controllerVersion, debug = false, log = console.log }) {
  const { raw } = await buildSignedRawTx(signer, baseRequest, gasOverrides, { debug, log });
  const uuid = await submitViaMetaMaskApi({ chainId, apiBase, controllerVersion }, raw, { debug, log });
  if (debug) log(`🆔 UUID: ${uuid}`);
  const minedHash = await pollBatchStatus({ chainId, apiBase }, uuid, { debug, log });
  return { uuid, minedHash };
}

async function waitForConfirmations(provider, txHash, confs = 2, pollMs = 1500) {
  const receipt = await provider.waitForTransaction(txHash);
  let currentConf = 1;
  while (currentConf < confs) {
    const head = await provider.getBlockNumber();
    currentConf = head - Number(receipt.blockNumber) + 1;
    if (currentConf >= confs) break;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return await provider.getTransactionReceipt(txHash);
}

module.exports = {
  buildSignedRawTx,
  signAndSubmitMetaMask,
  waitForConfirmations
};

// Batch helpers
async function signAndSubmitBatchMetaMask({ signer, baseRequests, gasOverrides, chainId, apiBase, controllerVersion, debug = false, log = console.log }) {
  if (!Array.isArray(baseRequests) || baseRequests.length === 0) throw new Error('baseRequests empty');
  const raws = [];
  const populatedList = [];
  for (const baseRequest of baseRequests) {
    const { raw, populated } = await buildSignedRawTx(signer, baseRequest, gasOverrides, { debug, log, fallbackGasLimit: 900000n });
    raws.push(raw);
    populatedList.push(populated);
  }
  const submitUrl = `${apiBase}/networks/${chainId}/submitTransactions`;
  const params = { stxControllerVersion: controllerVersion };
  if (debug) log(`🌐 POST ${submitUrl}?stxControllerVersion=${controllerVersion} rawTxs=${raws.length}`);
  let data;
  try {
    const payload = { rawTxs: raws, rawCancelTxs: [] };
    if (debug) log(`🧾 Submit payload: ${JSON.stringify(payload)}`);
    ({ data } = await axios.post(submitUrl, payload, { params, timeout: 60_000 }));
    if (debug) log(`✅ Submit response: ${JSON.stringify(data)}`);
  } catch (e) {
    const status = e?.response?.status;
    const body = e?.response?.data;
    if (debug) log(`❌ Submit batch error status=${status} body=${JSON.stringify(body)}`);
    throw e;
  }
  const uuid = data?.uuid;
  if (!uuid) throw new Error('MetaMask batch submit: missing uuid');
  return { uuid, raws, populatedList };
}

async function pollBatchStatusEntry({ chainId, apiBase }, uuid, { timeoutMs = 180_000, intervalMs = 1500, debug = false, log = console.log } = {}) {
  const statusUrl = `${apiBase}/networks/${chainId}/batchStatus`;
  const start = Date.now();
  let it = 0;
  while (Date.now() - start < timeoutMs) {
    let data;
    try {
      ({ data } = await axios.get(statusUrl, { params: { uuids: uuid }, timeout: 30_000 }));
    } catch (e) {
      if (debug) log(`❌ Poll error: ${e?.message}`);
      throw e;
    }
    const entry = data?.[uuid];
    if (debug) {
      it++;
      log(`⏱️  Poll #${it}: isSettled=${entry?.isSettled} minedTx=${entry?.minedTx} minedHash=${entry?.minedHash || ''}`);
    }
    if (entry?.isSettled) return entry;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('MetaMask batch did not settle in time');
}

module.exports.signAndSubmitBatchMetaMask = signAndSubmitBatchMetaMask;
module.exports.pollBatchStatusEntry = pollBatchStatusEntry;
