const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateInitData } = require('../backend/src/telegram/validateInitData');

const token = 'test-bot-token';
const now = Math.floor(Date.now() / 1000);
const params = new URLSearchParams({
  auth_date: String(now),
  query_id: 'test-query',
  user: JSON.stringify({ id: 123456789, first_name: 'Test' })
});
const checkString = [...params.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => key + '=' + value)
  .join('\n');
const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
params.set('hash', hash);

const valid = validateInitData(params.toString(), token);
assert.equal(valid.user.id, 123456789, 'valid initData should return Telegram user');

const tampered = new URLSearchParams(params);
tampered.set('user', JSON.stringify({ id: 987654321 }));
assert.equal(validateInitData(tampered.toString(), token), null, 'tampered initData must be rejected');
assert.equal(validateInitData(params.toString(), 'wrong-token'), null, 'wrong bot token must be rejected');

const stale = new URLSearchParams(params);
stale.set('auth_date', String(now - 7200));
const staleCheck = [...stale.entries()].filter(([key]) => key !== 'hash')
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => key + '=' + value).join('\n');
const staleHash = crypto.createHmac('sha256', secret).update(staleCheck).digest('hex');
stale.set('hash', staleHash);
assert.equal(validateInitData(stale.toString(), token), null, 'expired initData must be rejected');

const future = new URLSearchParams(params);
future.set('auth_date', String(now + 120));
const futureCheck = [...future.entries()].filter(([key]) => key !== 'hash')
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => key + '=' + value).join('\n');
const futureHash = crypto.createHmac('sha256', secret).update(futureCheck).digest('hex');
future.set('hash', futureHash);
assert.equal(validateInitData(future.toString(), token), null, 'future-dated initData must be rejected');

console.log('Telegram initData authentication tests: OK');
