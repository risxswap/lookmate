import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseProperties, qiniuEtag, sign, syncAsset } from './sync-catalog-assets.mjs';

const config = { bucket: 'private', accessKey: 'test-access', secretKey: 'test-secret', uploadUrl: 'https://upload.example' };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test('Qiniu signatures preserve Base64 padding and match the Java SDK fixed vector', () => {
  assert.equal(sign('test-secret', 'test-message'), 'LphxF9dQFKmNDW_rKo95YX5aWpg=');
  assert.equal(qiniuEtag(Buffer.alloc(0)), 'Fto5o-5ea0sNMlW_75VgGJCv2AcJ');
  assert.equal(qiniuEtag(Buffer.alloc(5 * 1024 * 1024)), 'lrMhp7oU8rzWSRlmUeGJ73Q2pVa-');
});

test('Java properties values retain escaped characters and line continuations', () => {
  assert.deepEqual(parseProperties('# ignored\nlookmate.assets.bucket=private\nsecret : part\\=one\\\\two\nkey=first\\\n  second\n'), {
    'lookmate.assets.bucket': 'private', secret: 'part=one\\two', key: 'firstsecond'
  });
});

test('immutable objects skip matching bytes, reject mismatches and use insert-only upload tokens', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lookmate-catalog-test-'));
  try {
    const file = path.join(directory, 'image.png');
    const bytes = Buffer.from('test-image');
    await fs.writeFile(file, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const asset = { file, sha256, key: `platform-catalog/hairstyles/v1/${sha256}/image.png`, filename: 'image.png', mime: 'image/png' };
    const metadata = { fsize: bytes.length, hash: qiniuEtag(bytes) };
    let calls = 0;
    assert.equal(await syncAsset(asset, config, async () => { calls++; return reply(200, metadata); }), 'existing');
    assert.equal(calls, 1);
    await assert.rejects(syncAsset(asset, config, async () => reply(200, { ...metadata, hash: 'different' })), /内容不一致/);
    assert.equal(await syncAsset(asset, config, async (url, options) => {
      if (url.startsWith('https://rs.qiniu.com/')) return reply(612, {});
      const token = options.body.get('token');
      assert.ok(token.split(':')[1].endsWith('='));
      const policy = JSON.parse(Buffer.from(token.split(':')[2], 'base64url').toString());
      assert.equal(policy.insertOnly, 1);
      assert.equal(policy.scope, `private:${asset.key}`);
      return reply(200, { key: asset.key, hash: metadata.hash });
    }), 'uploaded');
    calls = 0;
    await assert.rejects(syncAsset(asset, config, async url => {
      calls++;
      return reply(url.startsWith('https://rs.qiniu.com/') ? 612 : 614, {});
    }), /并发上传核验失败/);
    assert.equal(calls, 3);
    await fs.writeFile(file, 'changed');
    await assert.rejects(syncAsset(asset, config, async () => { throw new Error('must not access remote'); }), /同步前发生变化/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
