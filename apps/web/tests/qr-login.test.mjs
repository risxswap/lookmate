import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const code = ts.transpileModule(readFileSync(new URL('../src/features/auth/qrLogin.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  const tasks = new Map(), states = [], calls = [], users = []; let counter = 0, timestamp = 0;
  const module = { exports: {} };
  new Function('module', 'exports', 'setTimeout', 'clearTimeout', code)(module, module.exports, fn => { tasks.set(++counter, fn); return counter; }, id => tasks.delete(id));
  const account = { id: '1', username: null, displayName: null, hasPassword: false, wechatBound: true, avatarFileId: null };
  const ticket = { id: 'qr1', expiresAt: new Date(300000).toISOString(), imageDataUrl: 'data:image/png;base64,AA==' };
  const api = {
    create: async signal => { calls.push(['create', signal]); return ticket; },
    status: async (id, signal) => { calls.push(['status', id, signal]); return { ...ticket, status: 'PENDING' }; },
    claim: async (id, signal) => { calls.push(['claim', id, signal]); return account; },
    account: async signal => { calls.push(['account', signal]); return account; }, ...overrides,
  };
  const flow = module.exports.createQrLogin(api, state => states.push(state), value => users.push(value), () => timestamp);
  return { flow, states, calls, users, ticket, account, tasks, advance: t => { timestamp = t; }, async poll() { const [id, fn] = tasks.entries().next().value; tasks.delete(id); await fn(); await tick(); } };
}
test('confirmed login claims once and stops polling', async () => {
  const h = harness({ status: async id => ({ id, expiresAt: new Date(300000).toISOString(), status: 'CONFIRMED' }) });
  await h.flow.refresh(); await h.poll();
  assert.equal(h.users.length, 1); assert.equal(h.calls.filter(c => c[0] === 'claim').length, 1); assert.equal(h.tasks.size, 0);
});
test('cancelled and expired codes do not claim or continue polling', async () => {
  for (const status of ['CANCELLED', 'EXPIRED']) {
    const h = harness({ status: async id => ({ id, expiresAt: new Date(300000).toISOString(), status }) });
    await h.flow.refresh(); await h.poll();
    assert.equal(h.states.at(-1).status, status); assert.equal(h.users.length, 0); assert.equal(h.tasks.size, 0);
  }
});
test('local expiry never calls status or claim after five minutes', async () => {
  const h = harness(); await h.flow.refresh(); h.advance(300000); await h.poll();
  assert.deepEqual(h.calls.map(c => c[0]), ['create']); assert.equal(h.states.at(-1).status, 'EXPIRED');
});
test('refresh aborts old query and ignores its late confirmation', async () => {
  let resolve; const h = harness({ status: () => new Promise(r => { resolve = r; }) });
  await h.flow.refresh(); const polling = h.poll(); await tick(); await h.flow.refresh();
  resolve({ id: 'qr1', status: 'CONFIRMED', expiresAt: new Date(300000).toISOString() }); await polling;
  assert.equal(h.users.length, 0); assert.equal(h.calls.filter(c => c[0] === 'claim').length, 0);
  assert.equal(h.states.at(-1).status, 'PENDING'); h.flow.stop();
});
test('unmount aborts creation and never schedules after its late result', async () => {
  let resolve; const h = harness({ create: () => new Promise(r => { resolve = r; }) });
  const pending = h.flow.refresh(); h.flow.stop(); resolve(h.ticket); await pending;
  assert.equal(h.tasks.size, 0); assert.equal(h.states.length, 1);
});
test('lost claim response reconciles via account read without repeating write', async () => {
  const h = harness({ status: async id => ({ id, expiresAt: new Date(300000).toISOString(), status: 'CONFIRMED' }), claim: async () => { throw new Error('network'); } });
  await h.flow.refresh(); await h.poll();
  assert.equal(h.users.length, 1); assert.equal(h.calls.filter(c => c[0] === 'account').length, 1);
});
test('failed claim reconciliation cannot retry claim on old ticket', async () => {
  let claims = 0;
  const h = harness({ status: async id => ({ id, expiresAt: new Date(300000).toISOString(), status: 'CONFIRMED' }), claim: async () => { claims++; throw new Error('network'); }, account: async () => { throw new Error('offline'); } });
  await h.flow.refresh(); await h.poll(); h.flow.retryStatus(); await tick();
  assert.equal(claims, 1); assert.equal(h.states.at(-1).canRetryStatus, false); assert.equal(h.tasks.size, 0);
});
test('query failure stops automatic retries and allows an explicit retry', async () => {
  let attempts = 0;
  const h = harness({ status: async id => { if (++attempts === 1) throw new Error('offline'); return { id, expiresAt: new Date(300000).toISOString(), status: 'CANCELLED' }; } });
  await h.flow.refresh(); await h.poll(); assert.equal(h.tasks.size, 0); assert.equal(h.states.at(-1).status, 'ERROR');
  h.flow.retryStatus(); await tick(); assert.equal(h.states.at(-1).status, 'CANCELLED');
});
