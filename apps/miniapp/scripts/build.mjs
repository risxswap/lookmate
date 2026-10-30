import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'src'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
for(const file of walk(src)){
  if(file.endsWith('.d.ts'))continue;
  const target=path.join(out,path.relative(src,file).replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(target),{recursive:true});
  if(file.endsWith('.ts'))fs.writeFileSync(target,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText);
  else fs.copyFileSync(file,target);
}
// Copy the dependency closure of used components only, including their template/style dependencies.
const pkg=path.join(root,'node_modules/tdesign-miniprogram/miniprogram_dist');
const dest=path.join(out,'miniprogram_npm/tdesign-miniprogram');
const selected=new Set(),pending=[];
function enqueue(file){if(fs.existsSync(file)&&fs.statSync(file).isFile()&&!selected.has(file))pending.push(file);}
function resolve(base,spec){
  let target=spec.startsWith('.')?path.resolve(path.dirname(base),spec):path.join(pkg,'miniprogram_npm',spec,'index');
  for(const suffix of ['','.js','.wxs','.wxss','.wxml','.json','/index.js'])if(fs.existsSync(target+suffix)&&fs.statSync(target+suffix).isFile()){enqueue(target+suffix);return;}
}
function component(base){for(const ext of ['.js','.json','.wxml','.wxss'])enqueue(base+ext);}
for(const file of walk(src).filter(f=>f.endsWith('.json'))){const config=JSON.parse(fs.readFileSync(file,'utf8'));for(const value of Object.values(config.usingComponents||{}))if(value.includes('tdesign-miniprogram/'))component(path.join(pkg,value.split('tdesign-miniprogram/')[1]));}
while(pending.length){const file=pending.pop();if(selected.has(file))continue;selected.add(file);const text=fs.readFileSync(file,'utf8');
 if(file.endsWith('.json'))for(const spec of Object.values(JSON.parse(text).usingComponents||{}))if(spec.startsWith('.'))component(path.resolve(path.dirname(file),spec));
 for(const match of text.matchAll(/(?:from\s*|require\(\s*|@import\s*|src\s*=\s*)['"]([^'"]+)['"]/g))if(!match[1].startsWith('http')&&!match[1].includes('{{'))resolve(file,match[1]);
}
for(const file of selected){let text=fs.readFileSync(file,'utf8');const target=path.join(dest,path.relative(pkg,file));fs.mkdirSync(path.dirname(target),{recursive:true});
 if(file.endsWith('.js')){text=text.replace(/(from\s*|require\(\s*)(['"])([^.'"][^'"]*)\2/g,(all,prefix,quote,spec)=>{const modulePath=path.join(pkg,'miniprogram_npm',spec,'index.js');if(!fs.existsSync(modulePath))throw new Error(`Unresolved dependency ${spec} in ${file}`);let relative=path.relative(path.dirname(file),modulePath).replaceAll(path.sep,'/');if(!relative.startsWith('.'))relative='./'+relative;return prefix+quote+relative+quote;});text=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,allowJs:true}}).outputText;}
 fs.writeFileSync(target,text);
}
fs.copyFileSync(path.join(root,'node_modules/tdesign-miniprogram/LICENSE'),path.join(dest,'LICENSE'));
console.log(`Built native miniapp and ${selected.size} TDesign dependency files.`);
