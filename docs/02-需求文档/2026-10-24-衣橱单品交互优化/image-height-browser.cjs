const { chromium } = require('/Users/ming/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; const checks = []; const sizes = [];
  page.on('pageerror', e => errors.push(e.message));
  const longText = '面料具有自然纹理，领口和袖口保持整洁。'.repeat(40);
  const features = { description: longText, colors: ['米色'], pattern: '纯色', fit: '宽松', materialDescription: longText, details: longText };
  const dress = { id: '1', name: '米色外套', categoryId: '1', color: '米色', seasons: ['AUTUMN'], notes: '日常外套，前后两张图片。', imageRevision: '1', images: [{ id: '11', fileId: 'coat', version: '1', sortOrder: 0, effectiveFeatures: features, recognitionId: null }, { id: '12', fileId: 'back', version: '1', sortOrder: 1, effectiveFeatures: { ...features, description: '背面特征' }, recognitionId: null }], recognition: null };
  await page.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname; if (!p.startsWith('/api/')) return route.continue(); let data = null;
    if (p === '/api/auth/me') data = { id: '1', username: 'fixture', displayName: '模拟账号' };
    else if (p === '/api/auth/csrf') data = { token: 'fixture', headerName: 'X-CSRF-TOKEN' };
    else if (p === '/api/dresses/categories') data = [{ id: '1', name: '外套', code: 'COAT' }];
    else if (p === '/api/dresses/1') data = dress;
    else if (p === '/api/outfits/1') data = { id: '1', name: '日常通勤', note: '', revision: '1', version: '1', groups: [], items: [{ dressId: '1', dressName: '米色外套', imageFileIds: ['coat'], missing: false }] };
    else if (p.endsWith('/ai-jobs/current')) data = { evaluation: null, image: null, latest: null };
    else if (p.endsWith('/ai-jobs')) data = { items: [], total: 0, page: 1, pageSize: 5 };
    else if (p.includes('/access')) data = { url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="${p.includes('back') ? '#cbd7cf' : '#e3dbc9'}"/><path d="M100 80 L40 120 L10 300 L70 315 L90 210 L90 520 L210 520 L210 210 L230 315 L290 300 L260 120 L200 80 L170 110 L130 110 Z" fill="#82988b"/><text x="80" y="570">${p.includes('back') ? 'Back' : 'Front'}</text></svg>`), expiresAt: '2027-01-01T00:00:00Z' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, requestId: 'fixture' }) });
  });
  try {
    await page.goto('http://127.0.0.1:5188/app/wardrobe/outfits/1');
    await page.getByRole('button', { name: '查看米色外套详情', exact: true }).click();
    await page.locator('.dress-detail-main-image img').waitFor();
    await page.waitForTimeout(400);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 900, height: 600 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(450);
      const metrics = await page.locator('.dress-detail-layout').evaluate(el => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
        const img = document.querySelector('.dress-detail-main-image img');
        return { main: box('.dress-detail-main-image'), thumbs: box('.dress-detail-thumbnails'), footer: box('.dress-detail-drawer .ant-drawer-footer'), gallery: box('.dress-detail-gallery'), fit: getComputedStyle(img).objectFit, infoScroll: document.querySelector('.dress-detail-information').scrollHeight > document.querySelector('.dress-detail-information').clientHeight, overflow: el.scrollWidth > el.clientWidth };
      });
      assert(metrics.main.height <= 350.1 && metrics.main.height > 100);
      assert(metrics.thumbs.y - metrics.main.bottom >= 11.9 && metrics.thumbs.y - metrics.main.bottom <= 12.1);
      assert(metrics.thumbs.bottom <= metrics.footer.y && metrics.footer.bottom <= viewport.height + 1);
      assert.equal(metrics.fit, 'contain'); assert.equal(metrics.overflow, false); assert(metrics.infoScroll);
      sizes.push({ viewport, ...metrics }); checks.push(`${viewport.width}×${viewport.height} 主图有界、等比完整、缩略图紧随且底栏可达`);
      await page.screenshot({ path: `${__dirname}/image-height-${viewport.width}.png`, fullPage: true });
    }
    const before = await page.locator('.dress-detail-main-image').boundingBox();
    await page.locator('.dress-detail-information').evaluate(el => { el.scrollTop = 250; });
    assert(await page.locator('.dress-detail-information').evaluate(el => el.scrollTop > 0));
    assert.deepEqual(await page.locator('.dress-detail-main-image').boundingBox(), before); checks.push('右侧资料独立滚动，图片区位置不变');
    await page.getByRole('button', { name: '选择第 2 张图片', exact: true }).click();
    await page.getByText('背面特征', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '选择第 2 张图片', exact: true }).getAttribute('aria-pressed'), 'true'); checks.push('多图切换同步更新图片特征');
    await page.locator('.dress-detail-main-image .ant-image').click();
    await page.locator('.ant-image-preview').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.ant-image-preview').waitFor({ state: 'hidden' });
    await page.locator('.dress-detail-main-image').waitFor(); checks.push('主图可放大并关闭返回详情');
    assert.deepEqual(errors, []);
    fs.writeFileSync(__dirname + '/image-height-results.json', JSON.stringify({ checks, sizes, errors, mockedApi: true, browser: browser.version(), node: process.version }, null, 2));
    console.log(checks);
  } catch (e) { await page.screenshot({ path: __dirname + '/image-height-failure.png', fullPage: true }); throw e; }
  finally { await browser.close(); }
})();
