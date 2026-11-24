import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('生产构建按入口加载页面，所有 JavaScript 分包均低于 500 kB', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { output } = await build({ root, build: { write: false }, logLevel: 'silent' });
  const chunks = output.filter(item => item.type === 'chunk');
  const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk.code) < 500_000, `${chunk.fileName} 超过 500 kB`);
  }

  function entry(source) {
    const chunk = chunks.find(item => item.facadeModuleId?.endsWith('/src/' + source));
    assert.ok(chunk, `找不到页面入口 ${source}`);
    return chunk;
  }

  function staticImports(...entries) {
    const files = new Set();
    while (entries.length) {
      const chunk = entries.pop();
      if (files.has(chunk.fileName)) continue;
      files.add(chunk.fileName);
      entries.push(...chunk.imports.map(file => byFile.get(file)));
    }
    return files;
  }

  const main = chunks.find(chunk => chunk.isEntry && chunk.facadeModuleId?.endsWith('/index.html'));
  assert.ok(main, '找不到 HTML 入口');
  const auth = entry('pages/AuthPage.tsx');
  const workspace = entry('pages/WorkspacePage.tsx');
  const dashboard = entry('features/planner/PlannerDashboard.tsx');
  const wardrobe = entry('features/wardrobe/WardrobePage.tsx');
  const loginFiles = staticImports(main, auth);
  const dashboardFiles = staticImports(main, workspace, dashboard);
  assert.ok(!loginFiles.has(workspace.fileName));
  assert.ok(!loginFiles.has(dashboard.fileName));
  assert.ok(!dashboardFiles.has(auth.fileName));
  assert.ok(!dashboardFiles.has(wardrobe.fileName));
});
