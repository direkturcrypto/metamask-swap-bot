const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function caip10(chainId, address) {
  return `eip155:${Number(chainId)}:${address}`;
}

function caip19Native(chainId) {
  // Native ETH on Base: slip44:60
  return `eip155:${Number(chainId)}/slip44:60`;
}

function caip19Erc20(chainId, token) {
  return `eip155:${Number(chainId)}/erc20:${token}`;
}

function headers({ clientId, sessionId, language }) {
  const h = { 'Content-Type': 'application/json', 'rewards-client-id': clientId };
  if (sessionId) h['rewards-access-token'] = sessionId;
  if (language) h['Accept-Language'] = language;
  return h;
}

async function signAuthMessage(signer, address, tsSecs) {
  const msg = `rewards,${address},${tsSecs}`;
  // personal_sign style; ethers signMessage prefixes EIP-191 which is typical for personal_sign
  return await signer.signMessage(ethers.toUtf8Bytes(msg));
}

function loadSessions(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function saveSessions(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

async function mobileLoginOrOptIn({ baseUrl, clientId, signer, address, referralCode, language, debug = false, log = console.log }) {
  const acct = address;
  async function attempt(urlPath, tsSecs) {
    const signature = await signAuthMessage(signer, acct, tsSecs);
    const body = { account: acct, timestamp: tsSecs, signature };
    if (urlPath.includes('mobile-optin') && referralCode) body.referralCode = referralCode;
    const url = `${baseUrl}${urlPath}`;
    if (debug) log(`🌐 POST ${url}`);
    try {
      const { data } = await axios.post(url, body, { headers: headers({ clientId, language }), timeout: 30_000 });
      return data;
    } catch (e) {
      const st = e?.response?.data?.serverTimestamp;
      if (debug) log(`❌ Auth error: ${e?.response?.status} ${JSON.stringify(e?.response?.data||{})}`);
      if (st) return { serverTimestamp: st };
      throw e;
    }
  }

  // Try login first with local time
  let ts = Math.floor(Date.now() / 1000);
  let res = await attempt('/auth/mobile-login', ts);
  if (res?.serverTimestamp) {
    ts = Math.floor(Number(res.serverTimestamp) / 1000);
    res = await attempt('/auth/mobile-login', ts);
  }
  if (res?.sessionId) return res;

  // If login failed, try opt-in
  ts = Math.floor(Date.now() / 1000);
  res = await attempt('/auth/mobile-optin', ts);
  if (res?.serverTimestamp) {
    ts = Math.floor(Number(res.serverTimestamp) / 1000);
    res = await attempt('/auth/mobile-optin', ts);
  }
  if (res?.sessionId) return res;
  throw new Error('Rewards auth failed');
}

async function ensureSession({ baseUrl, clientId, sessionsPath, signer, address, referralCode, language, debug = false, log = console.log }) {
  const store = loadSessions(sessionsPath);
  if (store[address]?.sessionId) {
    return { sessionId: store[address].sessionId, subscriptionId: store[address].subscriptionId };
  }
  const data = await mobileLoginOrOptIn({ baseUrl, clientId, signer, address, referralCode, language, debug, log });
  const sessionId = data.sessionId;
  const subscriptionId = data.subscription?.id;
  store[address] = { sessionId, subscriptionId };
  saveSessions(sessionsPath, store);
  return { sessionId, subscriptionId };
}

async function getCurrentSeason({ baseUrl, clientId, sessionId, language, debug = false, log = console.log }) {
  const url = `${baseUrl}/seasons/current/status`;
  if (debug) log(`🌐 GET ${url}`);
  const { data } = await axios.get(url, { headers: headers({ clientId, sessionId, language }), timeout: 30_000 });
  return data;
}

async function getLastUpdated({ baseUrl, clientId, sessionId, seasonId, language, debug = false, log = console.log }) {
  const url = `${baseUrl}/seasons/${seasonId}/points-events/last-updated`;
  if (debug) log(`🌐 GET ${url}`);
  const { data } = await axios.get(url, { headers: headers({ clientId, sessionId, language }), timeout: 30_000 });
  return data;
}

async function getPointsEvents({ baseUrl, clientId, sessionId, seasonId, cursor, language, debug = false, log = console.log }) {
  const url = `${baseUrl}/seasons/${seasonId}/points-events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  if (debug) log(`🌐 GET ${url}`);
  const { data } = await axios.get(url, { headers: headers({ clientId, sessionId, language }), timeout: 30_000 });
  return data;
}

async function estimateSwapPoints({ baseUrl, clientId, chainId, address, srcAssetId, destAssetId, feeAssetId, srcAmount, destAmount = '0', feeAmount = '0', language, debug = false, log = console.log }) {
  const url = `${baseUrl}/points-estimation`;
  const body = {
    activityType: 'SWAP',
    account: caip10(chainId, address),
    activityContext: {
      swapContext: {
        srcAsset: { id: srcAssetId, amount: String(srcAmount) },
        destAsset: { id: destAssetId, amount: String(destAmount) },
        feeAsset: { id: feeAssetId, amount: String(feeAmount) }
      }
    }
  };
  if (debug) {
    log(`🌐 POST ${url} (points-estimation)`);
    log(`🧾 Rewards estimation payload: ${JSON.stringify(body)}`);
  }
  const { data } = await axios.post(url, body, { headers: headers({ clientId, language }), timeout: 30_000 });
  return data; // { pointsEstimate, bonusBips }
}

module.exports = {
  caip10,
  caip19Native,
  caip19Erc20,
  ensureSession,
  getCurrentSeason,
  getLastUpdated,
  getPointsEvents,
  estimateSwapPoints
};
