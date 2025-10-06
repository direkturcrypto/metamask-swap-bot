const fs = require('fs');
const path = require('path');
require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseNumber(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number`);
  return n;
}

const CHAIN_ID = Number(required('CHAIN_ID'));
const RPC_URL = required('RPC_URL');
// Hardcoded quote API base per requirements
const QUOTE_API_BASE = 'https://api-metamask.xto.lol';
const SLIPPAGE = parseNumber('SLIPPAGE', 0.01);
const GAS_INCLUDED = String(process.env.GAS_INCLUDED || 'true').toLowerCase() === 'true';
const RESET_APPROVAL = String(process.env.RESET_APPROVAL || 'false').toLowerCase() === 'true';
const ROUTER_ADDRESS = (process.env.ROUTER_ADDRESS || '').trim() || '0x9dDA6Ef3D919c9bC8885D5560999A3640431e8e6';

const USDC_ADDRESS = required('USDC_ADDRESS');
const WETH_ADDRESS = required('WETH_ADDRESS');

const ETH_THRESHOLD = parseNumber('ETH_THRESHOLD', 0.002);
const USDC_MIN_SWAP = parseNumber('USDC_MIN_SWAP', 1);
const ETH_MIN_SWAP = parseNumber('ETH_MIN_SWAP', 0.001);
const GAS_MIN_RESERVE = parseNumber('GAS_MIN_RESERVE', 0.0002);

const GAS_PRICE_MAX_GWEI = process.env.GAS_PRICE_MAX_GWEI ? Number(process.env.GAS_PRICE_MAX_GWEI) : undefined;
const DELAY_SECONDS_MIN = parseNumber('DELAY_SECONDS_MIN', 45);
const DELAY_SECONDS_MAX = parseNumber('DELAY_SECONDS_MAX', 90);

function loadWallets() {
  const p = path.resolve(process.cwd(), 'wallets.json');
  if (!fs.existsSync(p)) throw new Error('wallets.json not found');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(data)) throw new Error('wallets.json must be an array');
  return data.map(w => ({
    address: String(w.address),
    privateKey: String(w.privateKey)
  }));
}

module.exports = {
  CHAIN_ID,
  RPC_URL,
  QUOTE_API_BASE,
  SLIPPAGE,
  GAS_INCLUDED,
  RESET_APPROVAL,
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
  ETH_THRESHOLD,
  USDC_MIN_SWAP,
  ETH_MIN_SWAP,
  GAS_MIN_RESERVE,
  GAS_PRICE_MAX_GWEI,
  DELAY_SECONDS_MIN,
  DELAY_SECONDS_MAX,
  loadWallets
};
