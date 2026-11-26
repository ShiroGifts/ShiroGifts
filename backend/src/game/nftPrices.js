const { GIFT_DATA } = require('./cases');
const { pool } = require('../db/pool');
const API = 'https://starprice.net/api/v1/gifts';
const MAX_CONCURRENCY = 3;
function collectTelegramStarPrices(data) {
  const prices = [];
  const collect = offers => {
    for (const offer of Array.isArray(offers) ? offers : []) {
      if (offer?.market === 'telegram' && String(offer.currency || '').toUpperCase() === 'STARS' &&
          Number.isFinite(Number(offer.price)) && Number(offer.price) > 0) prices.push(Number(offer.price));
    }
  };
  collect(data?.offers);
  for (const model of Array.isArray(data?.models) ? data.models : []) collect(model?.offers);
  return prices;
}
async function fetchGiftCollection(name) {
  const response = await fetch(API + '/' + encodeURIComponent(name), { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('price_provider_http_' + response.status);
  return response.json();
}
async function updateNftPrices() {
  const nftKeys = Object.entries(GIFT_DATA).filter(([key, gift]) => key !== 'random_nft' && String(gift.rarity || '').toUpperCase().includes('NFT'));
  let updated = 0;
  for (let i = 0; i < nftKeys.length; i += MAX_CONCURRENCY) {
    const batch = nftKeys.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async ([key, gift]) => {
      const name = key === 'plush_pepe_royal' ? 'Plush Pepe' : String(gift.name || '').replace(/\s*NFT(?:\s*·.*)?$/i, '').trim();
      const data = await fetchGiftCollection(name);
      const prices = collectTelegramStarPrices(data).sort((a, b) => a - b).slice(0, 5);
      if (!prices.length) return null;
      const average = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
      if (!Number.isSafeInteger(average) || average < 1) return null;
      GIFT_DATA[key].value = average;
      await pool.query("UPDATE inventory SET value_stars=$1 WHERE item_key=$2 AND status NOT IN ('sold','withdrawn')", [average, key]);
      return { key, average, samples: prices.length };
    }));
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) updated++;
      else if (result.status === 'rejected') console.warn('[NFT PRICES] Collection refresh failed:', result.reason?.message || result.reason);
    }
  }
  console.log('[NFT PRICES] Daily price refresh complete; updated ' + updated + ' NFT gift keys');
  return updated;
}
function scheduleNextUtcRefresh() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0));
  const timer = setTimeout(async () => {
    try { await updateNftPrices(); }
    catch (error) { console.error('[NFT PRICES] Daily refresh failed:', error.message); }
    scheduleNextUtcRefresh();
  }, Math.max(1000, next.getTime() - now.getTime()));
  timer.unref?.();
}
function startDailyNftPriceRefresh() {
  updateNftPrices().catch(error => console.error('[NFT PRICES] Initial refresh failed:', error.message));
  scheduleNextUtcRefresh();
}
module.exports = { updateNftPrices, startDailyNftPriceRefresh };
