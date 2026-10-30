import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/app/navigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function browser(start = '/app', previous = 'https://elsewhere.example/') {
  const origin = 'https://lookmate.example';
  const entries = [{ href: previous, state: null }, { href: new URL(start, origin).href, state: null }];
  let cursor = 1; let listeners = {}; const storage = new Map();
  const window = {
    get location() { return new URL(entries[cursor].href); }, scrollTo() {},
    addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
    removeEventListener() {},
    dispatchEvent(event) { let stopped = false; event.stopImmediatePropagation = () => { stopped = true; }; for (const fn of listeners[event.type] ?? []) { fn(event); if (stopped) break; } },
    history: {
      get state() { return entries[cursor].state; },
      replaceState(state, _, href) { entries[cursor] = { state: structuredClone(state), href: String(href) }; },
      pushState(state, _, href) { entries.splice(cursor + 1); entries.push({ state: structuredClone(state), href: String(href) }); cursor++; },
      go(delta) { const target = cursor + delta; if (target < 0 || target >= entries.length) return; cursor = target; window.dispatchEvent({ type: 'popstate', state: this.state }); },
    },
  };
  function reload() {
    listeners = {};
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', 'sessionStorage', source)(() => ({ useRef: v => ({ current: v }), useCallback: fn => fn, useSyncExternalStore: (_, read) => read() }), module, module.exports, window, { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) });
    return module.exports;
  }
  return { window, reload, api: reload(), visit(api, path, replace = false) { api.navigate(new URL(path, origin), replace); } };
}
test('direct detail / editor links fall back inside workspace, regardless of external or login predecessor', () => {
  for (const previous of ['https://elsewhere.example/', 'https://lookmate.example/login']) {
    for (const [path, expected] of [['/app/designs/42', '/app/designs'], ['/app/wardrobe/outfits/8', '/app/wardrobe?tab=outfits'], ['/app/wardrobe/outfits/8/edit', '/app/wardrobe?tab=outfits'], ['/app/design/new', '/app'], ['/app/profile', '/app']]) {
      const b = browser(path, previous); b.api.goBack();
      assert.equal(b.window.location.pathname + b.window.location.search, expected);
    }
  }
});
test('detail returns to its actual source; refresh and browser forward retain source', () => {
  for (const source of ['/app', '/app/designs?tab=favorites']) {
    const b = browser(source); b.visit(b.api, '/app/designs/42'); const api = b.reload(); api.goBack();
    assert.equal(b.window.location.pathname + b.window.location.search, source);
    b.window.history.go(1); api.goBack();
    assert.equal(b.window.location.pathname + b.window.location.search, source);
  }
});
test('cancelled back restores editor once, and accepting next back leaves normally', () => {
  const b = browser('/app/wardrobe?tab=outfits'); b.visit(b.api, '/app/wardrobe/outfits/8/edit');
  let prompts = 0; b.api.setNavigationGuard(() => { prompts++; return false; }); b.api.goBack();
  assert.equal(b.window.location.pathname, '/app/wardrobe/outfits/8/edit'); assert.equal(prompts, 1);
  b.api.setNavigationGuard(() => true); b.api.goBack(); assert.equal(b.window.location.pathname, '/app/wardrobe');
});
test('saved editor is replaced and repeated detail does not form a return loop', () => {
  const b = browser('/app/wardrobe?tab=outfits'); b.visit(b.api, '/app/wardrobe/outfits/8'); b.visit(b.api, '/app/wardrobe/outfits/8/edit');
  b.visit(b.api, '/app/wardrobe/outfits/8', true); b.api.goBack(); assert.equal(b.window.location.pathname, '/app/wardrobe');
});
test('list filters, page and tab survive navigation/reload and remain account scoped', () => {
  const b = browser('/app/designs');
  b.api.usePageState('account-a:records', 'page', 1)[1](3);
  b.api.usePageState('account-a:records', 'filter', '')[1]('SUCCEEDED');
  b.api.usePageState('account-a:favorites', 'collection', { id: '', name: '' })[1]({ id: '7', name: '通勤' });
  b.api.replaceTab('favorites'); b.visit(b.api, '/app/designs/42');
  let api = b.reload(); api.goBack(); api = b.reload();
  assert.equal(api.usePageState('account-a:records', 'page', 1)[0], 3);
  assert.equal(api.usePageState('account-a:records', 'filter', '')[0], 'SUCCEEDED');
  assert.deepEqual(api.usePageState('account-a:favorites', 'collection', {})[0], { id: '7', name: '通勤' });
  assert.equal(api.usePageState('account-b:records', 'page', 1)[0], 1);
  assert.equal(b.window.location.search, '?tab=favorites');
  b.visit(api, '/app/profile'); b.visit(api, '/app/designs');
  assert.equal(api.usePageState('account-a:records', 'page', 1)[0], 1);
});
test('logout invalidates earlier navigation ancestry', () => {
  const b = browser('/app/profile'); b.visit(b.api, '/app/designs/42'); b.api.clearNavigationSession(); b.reload().goBack();
  assert.equal(b.window.location.pathname, '/app/designs');
});

test('hairstyle trial falls back to gallery and direct hair detail uses supplied record fallback', () => {
  const b = browser('/app/hairstyles/try?path=free'); b.api.goBack(); assert.equal(b.window.location.pathname, '/app/hairstyles');
  const d = browser('/app/designs/42?from=hairstyles'); d.api.goBack('/app/hairstyles/records'); assert.equal(d.window.location.pathname, '/app/hairstyles/records');
});
