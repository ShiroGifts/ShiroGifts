const { GIFT_DATA } = require('./cases');
const { pool } = require('../db/pool');
const API = 'https://starprice.net/api/v1/gifts';
const MAX_CONCURRENCY = 3;
const REFRESH_INTERVAL_MS = 7 * 60 * 60 * 1000;

function collectPortalsTonPrices(data) {
  const prices = [];
  const collect = offers => {
    for (const offer of Array.isArray(offers) ? offers : []) {
      if (offer?.market === 'portals' &&
          String(offer.currency || '').toUpperCase() === 'GRAM' &&
          Number.isFinite(Number(offer.price)) && Number(offer.price) > 0) {
        prices.push(Number(offer.price));
      }
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
      const portalsPrices = collectPortalsTonPrices(data).sort((a, b) => a - b);
      if (!portalsPrices.length) return null;
      // Portals floor prices are in GRAM (TON denomination). The app stores NFT values in Stars,
      // using the app's fixed 1 TON = 100 Stars conversion so TON mode displays the floor.
      const lowestTon = portalsPrices[0];
      const valueStars = Math.round(lowestTon * 100);
      if (!Number.isSafeInteger(valueStars) || valueStars < 1) return null;
      GIFT_DATA[key].value = valueStars;
      await pool.query("UPDATE inventory SET value_stars=$1 WHERE item_key=$2 AND status NOT IN ('sold','withdrawn')", [valueStars, key]);
      return { key, lowestTon, valueStars };
    }));
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) updated++;
      else if (result.status === 'rejected') console.warn('[NFT PRICES] Portals price refresh failed:', result.reason?.message || result.reason);
    }
  }
  console.log('[NFT PRICES] Portals floor refresh complete; updated ' + updated + ' NFT gift keys');
  return updated;
}
function scheduleNextRefresh() {
  const timer = setTimeout(async () => {
    try { await updateNftPrices(); }
    catch (error) { console.error('[NFT PRICES] Portals refresh failed:', error.message); }
    scheduleNextRefresh();
  }, REFRESH_INTERVAL_MS);
  timer.unref?.();
}
function startDailyNftPriceRefresh() {
  updateNftPrices().catch(error => console.error('[NFT PRICES] Initial Portals refresh failed:', error.message));
  scheduleNextRefresh();
}
module.exports = { updateNftPrices, startDailyNftPriceRefresh };
