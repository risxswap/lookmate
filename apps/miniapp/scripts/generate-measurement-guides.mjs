// Maintenance only: regenerate the bundled PNGs from the Web editor's vector geometry.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const web = new URL('../../web/src/features/profile/', import.meta.url);
const output = new URL('../src/assets/measurements/', import.meta.url);
const silhouette = readFileSync(new URL('bodySilhouette.ts', web), 'utf8');
const editor = ts.createSourceFile('BodyMeasurementEditor.tsx', readFileSync(new URL('BodyMeasurementEditor.tsx', web), 'utf8'), ts.ScriptTarget.Latest, true);
function webFunction(name) {
  const declaration = editor.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Web editor no longer defines ${name}; update the generator`);
  return declaration.getText(editor);
}
const geometry = ts.transpileModule(`${silhouette}\n${webFunction('measurementRings')}\n${webFunction('measurementLengths')}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const { bodySilhouette, measurementRings, measurementLengths } = runInNewContext(
  `${geometry}\n({ bodySilhouette: exports.bodySilhouette, measurementRings, measurementLengths })`, { exports: {} },
);
// Foot() contains exactly the outline, the length marker and the width marker, in that order.
const footPaths = [...webFunction('Foot').matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
if (footPaths.length !== 3) throw new Error('Web foot paths changed; update the generator');
const [footOutline, footLength, footWidth] = footPaths;

// Web's head/arm/leg boxes, plus compact upper-body crops and the full-body height view.
const boxes = {
  head: [150, 25, 100, 120], neck: [130, 25, 140, 135], arms: [82, 125, 105, 255],
  legs: [125, 235, 150, 395], torso: [85, 112, 230, 251], height: [40, 15, 320, 625],
  foot: [0, 0, 160, 245],
};
function bodyBox(key) {
  if (key === 'head' || key === 'neck' || key === 'height') return boxes[key];
  if (['armLength', 'upperArm', 'forearm', 'wrist'].includes(key)) return boxes.arms;
  if (['inseam', 'outseam', 'thigh', 'knee', 'calf', 'ankle'].includes(key)) return boxes.legs;
  return boxes.torso;
}
const outline = path => `<path fill="#b8bcb9" d="${path}"/>`;
const marker = (path, dash = '') => `<path d="${path}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const dot = (x, y, radius) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="#3f7862" stroke="#fff" stroke-width="${radius * 0.4}"/>`;
const lineGroup = (stroke, content) => `<g fill="none" stroke="#3f7862" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;
const temporary = mkdtempSync(join(tmpdir(), 'lookmate-measurements-'));
const names = [];
function render(name, box, artwork) {
  const [, , width, height] = box;
  const scale = 544 / Math.max(width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="${box.join(' ')}">${artwork}</svg>`;
  const source = join(temporary, `${name}.svg`);
  const png = join(temporary, `${name}.png`);
  writeFileSync(source, svg);
  execFileSync('sips', ['-s', 'format', 'png', source, '--out', png], { stdio: 'pipe' });
  names.push(name);
}
try {
  for (const gender of ['FEMALE', 'MALE']) {
    const silhouettePath = bodySilhouette[gender.toLowerCase()];
    const rings = measurementRings(gender);
    const back = measurementLengths(gender, true);
    const lengths = {
      ...measurementLengths(gender, false), backWidth: back.backWidth, backWaistLength: back.backWaistLength,
    };
    for (const key of [...Object.keys(rings), ...Object.keys(lengths)]) {
      const box = bodyBox(key);
      // Keep full-body lines legible when the art is scaled down on a short phone screen.
      const stroke = Math.max(2, box[3] / 140);
      const radius = stroke * 1.5;
      let line;
      if (rings[key]) {
        const [x, y, rx, ry] = rings[key];
        line = marker(`M${x - rx} ${y} A${rx} ${ry} 0 0 1 ${x + rx} ${y}`, '4 4')
          + marker(`M${x - rx} ${y} A${rx} ${ry} 0 0 0 ${x + rx} ${y}`)
          + dot(x - rx, y, radius) + dot(x + rx, y, radius);
      } else {
        const { path, ends: [x1, y1, x2, y2] } = lengths[key];
        line = marker(path) + dot(x1, y1, radius) + dot(x2, y2, radius);
      }
      render(`${gender.toLowerCase()}-${key}`, box, outline(silhouettePath) + lineGroup(stroke, line));
    }
  }
  for (const [side, transform] of [['left', ''], ['right', 'translate(160 0) scale(-1 1)']]) {
    for (const [dimension, path] of [['Length', footLength], ['Width', footWidth]]) {
      render(`${side}Foot${dimension}`, boxes.foot, `<g transform="${transform}">${outline(footOutline)}${lineGroup(2, marker(path))}</g>`);
    }
  }
  // Preserve transparency, but avoid shipping 48 full-color RGBA files.
  execFileSync('python3', ['-c', `
from pathlib import Path
from PIL import Image
import sys

for path in Path(sys.argv[1]).glob('*.png'):
    with Image.open(path) as image:
        indexed = image.convert('RGBA').quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    indexed.save(path, optimize=True)
`, temporary], { stdio: 'inherit' });
  for (const name of names) copyFileSync(join(temporary, `${name}.png`), new URL(`${name}.png`, output));
  console.log(`Generated ${names.length} measurement guide PNGs.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
