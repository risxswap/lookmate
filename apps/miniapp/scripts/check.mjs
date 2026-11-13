import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const errors = [];
const pages = [
  ...app.pages,
  ...(app.subPackages || []).flatMap(pack => pack.pages.map(page => `${pack.root}/${page}`))
];

for (const page of pages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(root, page + extension))) {
      errors.push(`Missing page ${page + extension}`);
    }
  }
}

for (const tab of app.tabBar.list) {
  if (!pages.includes(tab.pagePath)) {
    errors.push(`Missing tab page ${tab.pagePath}`);
  }
  for (const key of ['iconPath', 'selectedIconPath']) {
    if (!tab[key]) continue;
    const icon = path.join(root, tab[key]);
    if (!fs.existsSync(icon)) {
      errors.push(`Missing tab icon ${tab[key]}`);
      continue;
    }
    const bytes = fs.readFileSync(icon);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)
      || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) {
      errors.push(`Invalid PNG tab icon ${tab[key]}`);
    }
  }
}

const walk = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(root);

for (const file of files) {
  if (file.endsWith('.json')) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const component of Object.values(config.usingComponents || {})) {
      const base = component.startsWith('/')
        ? path.join(root, component)
        : path.resolve(path.dirname(file), component);
      for (const extension of ['.js', '.json', '.wxml']) {
        if (!fs.existsSync(base + extension)) {
          errors.push(`Missing component ${base + extension}`);
        }
      }
    }
  }

  if (!file.endsWith('.wxml')) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (/\{\{[^}]*\.(?:map|filter|join|slice|toFixed)\(/.test(text)) {
    errors.push(`Unsupported WXML expression: ${file}`);
  }
  for (const match of text.matchAll(/wx:(?:if|elif)\s*=\s*(["'])([\s\S]*?)\1/g)) {
    if (!/^\s*\{\{[\s\S]*\}\}\s*$/.test(match[2])) {
      errors.push(`Literal WXML condition: ${file}: ${match[0]}`);
    }
  }
  for (const match of text.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    if (match[0].includes('&amp;&amp;')) {
      errors.push(`HTML-escaped WXML operator: ${file}: ${match[0]}`);
    }
  }
  for (const match of text.matchAll(/<image\b[^>]*?\bsrc\s*=\s*(["'])([^"']*)\1/g)) {
    const source = match[2].trim();
    if (!source || source.includes('{{') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) continue;
    const image = source.startsWith('/')
      ? path.join(root, source)
      : path.resolve(path.dirname(file), source);
    if (!fs.existsSync(image)) {
      errors.push(`Missing local image ${source} in ${path.relative(root, file)}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const buildBytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
console.log(`Validated ${pages.length} page routes, component dependencies and local images. Build bytes: ${buildBytes}`);
