#!/usr/bin/env node
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(projectRoot, 'apps/server/src/main/resources');
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const base64url = value => Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
export const sign = (secret, value) => base64url(createHmac('sha1', secret).update(value).digest());

export function parseProperties(text) {
  const properties = {};
  const unescape = value => value.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, unicode, escaped) => {
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
    return ({ t: '\t', n: '\n', r: '\r', f: '\f' })[escaped] ?? escaped;
  });
  let continued = '';
  for (const physical of text.split(/\r?\n/)) {
    const line = continued + physical.trimStart();
    const trailing = line.match(/\\+$/)?.[0].length || 0;
    if (trailing % 2 === 1) { continued = line.slice(0, -1); continue; }
    continued = '';
    if (!line || /^[#!]/.test(line)) continue;
    const entry = line.match(/^((?:\\.|[^\s=:])+)(?:\s*[=:]\s*|\s+)(.*)$/);
    if (!entry) throw new Error('配置文件包含无法解析的 properties 行');
    properties[unescape(entry[1])] = unescape(entry[2]);
  }
  if (continued) throw new Error('配置文件末尾包含未完成的续行');
  return properties;
}

export function qiniuEtag(bytes) {
  const blockBytes = 4 * 1024 * 1024;
  const hashes = [];
  for (let offset = 0; offset < bytes.length; offset += blockBytes) {
    hashes.push(createHash('sha1').update(bytes.subarray(offset, offset + blockBytes)).digest());
  }
  const hash = bytes.length <= blockBytes
    ? createHash('sha1').update(bytes).digest()
    : createHash('sha1').update(Buffer.concat(hashes)).digest();
  return base64url(Buffer.concat([Buffer.from([bytes.length <= blockBytes ? 0x16 : 0x96]), hash]));
}

export async function catalogueAssets(root = resources) {
  const assets = [];
  for (const catalogue of ['hairstyles', 'outfit-inspirations']) {
    const directory = path.join(root, catalogue);
    const versions = (await fs.readdir(directory)).filter(version => /^v[1-9][0-9]{0,8}$/.test(version)).sort();
    for (const version of versions) {
      const entries = JSON.parse(await fs.readFile(path.join(directory, version, 'catalog.json'), 'utf8'));
      const images = entries.flatMap(entry => catalogue === 'hairstyles' ? entry.images : [entry.image]);
      const seen = new Set();
      for (const image of images) {
        const filename = image.filename || image.file;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.(png|jpg|jpeg|webp)$/.test(filename)) {
          throw new Error(`目录图片文件名不正确 ${catalogue}/${version}`);
        }
        if (seen.has(filename)) continue;
        seen.add(filename);
        const file = path.join(directory, version, filename);
        const bytes = await fs.readFile(file);
        if (bytes.length < 1 || bytes.length > 20 * 1024 * 1024) throw new Error(`目录图片大小不正确 ${filename}`);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (image.sha256 && image.sha256 !== sha256) throw new Error(`目录图片摘要不一致 ${filename}`);
        if (image.sizeBytes !== undefined && image.sizeBytes !== bytes.length) throw new Error(`目录图片大小与登记不一致 ${filename}`);
        assets.push({
          file, filename, sha256, sizeBytes: bytes.length, mime: mimeTypes[path.extname(filename)],
          key: `platform-catalog/${catalogue}/${version}/${sha256}/${filename}`
        });
      }
    }
  }
  return assets;
}

export function storageConfig(properties) {
  const get = name => properties[`lookmate.assets.${name}`]?.trim();
  const config = { accessKey: get('access-key'), secretKey: get('secret-key'), bucket: get('bucket'), uploadUrl: get('upload-url') };
  if (Object.values(config).some(value => !value)) throw new Error('七牛配置缺少 access-key、secret-key、bucket 或 upload-url');
  const upload = new URL(config.uploadUrl);
  if (upload.protocol !== 'https:' || upload.username || upload.password) throw new Error('七牛上传地址必须为 HTTPS');
  return config;
}

export async function syncAsset(asset, config, send = fetch) {
  const bytes = await fs.readFile(asset.file);
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`目录图片同步前发生变化 ${asset.key}`);
  }
  const expectedHash = qiniuEtag(bytes);
  const statPath = `/stat/${base64url(`${config.bucket}:${asset.key}`)}`;
  const statOptions = {
    headers: { Authorization: `QBox ${config.accessKey}:${sign(config.secretKey, `${statPath}\n`)}` },
    signal: AbortSignal.timeout(30000)
  };
  const stat = await send(`https://rs.qiniu.com${statPath}`, statOptions);
  if (stat.ok) {
    const metadata = await stat.json();
    if (metadata.hash !== expectedHash || metadata.fsize !== bytes.length) throw new Error(`已有对象内容不一致 ${asset.key}`);
    return 'existing';
  }
  if (stat.status !== 612) throw new Error(`七牛对象查询失败 HTTP ${stat.status} ${asset.key}`);

  const policy = base64url(JSON.stringify({
    scope: `${config.bucket}:${asset.key}`, deadline: Math.floor(Date.now() / 1000) + 300,
    insertOnly: 1, fsizeLimit: bytes.length, detectMime: 1, mimeLimit: asset.mime
  }));
  const form = new FormData();
  form.set('key', asset.key);
  form.set('token', `${config.accessKey}:${sign(config.secretKey, policy)}:${policy}`);
  form.set('file', new Blob([bytes], { type: asset.mime }), asset.filename);
  const result = await send(config.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  if (result.status === 614) {
    // Another invocation may have uploaded this immutable object after stat.
    const concurrent = await send(`https://rs.qiniu.com${statPath}`, { ...statOptions, signal: AbortSignal.timeout(30000) });
    if (!concurrent.ok) throw new Error(`七牛并发上传核验失败 HTTP ${concurrent.status} ${asset.key}`);
    const metadata = await concurrent.json();
    if (metadata.hash !== expectedHash || metadata.fsize !== bytes.length) throw new Error(`已有对象内容不一致 ${asset.key}`);
    return 'existing';
  }
  if (!result.ok) {
    const body = await result.json().catch(() => ({}));
    const detail = typeof body.error === 'string' ? body.error
      .replaceAll(config.accessKey, '[credential]').replaceAll(config.secretKey, '[credential]')
      .replace(/https?:\/\/\S+/g, '[URL]')
      .replace(/[A-Za-z0-9_-]{20,}:[A-Za-z0-9_=-]{20,}(?::[A-Za-z0-9_=-]+)?/g, '[token]').slice(0, 160) : '';
    throw new Error(`七牛上传失败 HTTP ${result.status} ${detail} ${asset.key}`);
  }
  const uploaded = await result.json();
  if (uploaded.key !== asset.key || uploaded.hash !== expectedHash) throw new Error(`七牛上传结果校验失败 ${asset.key}`);
  return 'uploaded';
}

async function main() {
  const args = process.argv.slice(2);
  let configFile = path.join(projectRoot, '.env.dev');
  let dryRun = false;
  let uploadUrl;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') dryRun = true;
    else if (args[index] === '--config' && args[index + 1]) configFile = path.resolve(args[++index]);
    else if (args[index] === '--upload-url' && args[index + 1]) uploadUrl = args[++index];
    else if (args[index] === '--help') {
      console.log('node tools/sync-catalog-assets.mjs [--config /absolute/config.properties] [--upload-url https://regional-upload.example] [--dry-run]');
      return;
    } else throw new Error('参数不正确，使用 --help 查看用法');
  }
  const assets = await catalogueAssets();
  const totalBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0);
  console.log(`已登记 ${assets.length} 张平台素材，共 ${totalBytes} 字节`);
  if (dryRun) { console.log('dry-run 完成，本地路径、大小与摘要检查通过'); return; }
  const properties = parseProperties(await fs.readFile(configFile, 'utf8'));
  if (uploadUrl) properties['lookmate.assets.upload-url'] = uploadUrl;
  const config = storageConfig(properties);
  const counts = { uploaded: 0, existing: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < assets.length) {
      const asset = assets[next++];
      try { counts[await syncAsset(asset, config)]++; }
      catch (error) {
        counts.failed++;
        console.error(error instanceof Error && !error.message.includes('fetch') ? error.message : `七牛连接失败 ${asset.key}`);
      }
      const complete = counts.uploaded + counts.existing + counts.failed;
      if (complete % 20 === 0 || complete === assets.length) console.log(`已处理 ${complete}/${assets.length}，新上传 ${counts.uploaded}，已存在 ${counts.existing}，失败 ${counts.failed}`);
    }
  }
  await Promise.all([worker(), worker()]);
  if (counts.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('图库同步未完成，请检查参数、配置文件及本地目录'); process.exitCode = 1; });
}
