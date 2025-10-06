const { ethers } = require('ethers');

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function normalizeDecimalString(value, decimals) {
  let s = String(value);
  // Handle scientific notation conservatively by expanding to a fixed decimal string
  if (/e/i.test(s)) {
    const num = Number(s);
    if (!Number.isFinite(num)) throw new Error(`Invalid numeric value: ${value}`);
    // Add a small cushion then we will truncate; cap to avoid huge strings
    const places = Math.min(decimals + 4, 30);
    s = num.toFixed(places);
  }
  if (!s.includes('.')) return s;
  const [intPart, fracPartRaw] = s.split('.');
  if (decimals <= 0) return intPart;
  // Remove any trailing non-digits from fractional part (safety)
  const fracPart = (fracPartRaw.match(/^\d+/) || [''])[0];
  if (fracPart.length <= decimals) return `${intPart}.${fracPart}`;
  // Truncate extra fractional digits to avoid ethers underflow
  return `${intPart}.${fracPart.slice(0, decimals)}`;
}

function toUnits(amountHuman, decimals) {
  const safe = normalizeDecimalString(amountHuman, decimals);
  return ethers.parseUnits(safe, decimals);
}

function fromUnits(amountWei, decimals) {
  return Number(ethers.formatUnits(amountWei, decimals));
}

function formatEth(wei) {
  return Number(ethers.formatEther(wei));
}

function maxBigInt(a, b) { return a > b ? a : b; }

function randomInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

module.exports = { sleep, toUnits, fromUnits, formatEth, maxBigInt, randomInt };
