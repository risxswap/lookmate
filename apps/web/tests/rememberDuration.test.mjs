import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/features/auth/rememberDuration.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function('module', 'exports', source)(module, module.exports);
const { rememberDuration } = module.exports;
test('显示配置期限并兼容缺少配置的旧服务', () => {
  assert.equal(rememberDuration(2592000), '30 天');
  assert.equal(rememberDuration(7200), '2 小时');
  assert.equal(rememberDuration(90), '90 秒');
  for (const value of [undefined, NaN, -1, 0, 0.5]) assert.equal(rememberDuration(value), undefined);
});
