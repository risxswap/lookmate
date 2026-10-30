import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','dist');const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));const errors=[];
const pages=[...app.pages,...(app.subPackages||[]).flatMap(p=>p.pages.map(v=>p.root+'/'+v))];
for(const p of pages)for(const ext of ['.js','.json','.wxml','.wxss'])if(!fs.existsSync(path.join(root,p+ext)))errors.push(`Missing page ${p+ext}`);
for(const t of app.tabBar.list)if(!pages.includes(t.pagePath))errors.push(`Missing tab page ${t.pagePath}`);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
for(const file of walk(root)){
 if(file.endsWith('.json')){const value=JSON.parse(fs.readFileSync(file,'utf8'));for(const c of Object.values(value.usingComponents||{})){const base=c.startsWith('/')?path.join(root,c):path.resolve(path.dirname(file),c);for(const ext of ['.js','.json','.wxml'])if(!fs.existsSync(base+ext))errors.push(`Missing component ${base+ext}`);}}
 if(file.endsWith('.wxml')){const text=fs.readFileSync(file,'utf8');if(/\{\{[^}]*\.(?:map|filter|join|slice|toFixed)\(/.test(text))errors.push(`Unsupported WXML expression: ${file}`);for(const match of text.matchAll(/wx:(?:if|elif)\s*=\s*(["'])([\s\S]*?)\1/g))if(!/^\s*\{\{[\s\S]*\}\}\s*$/.test(match[2]))errors.push(`Literal WXML condition: ${file}: ${match[0]}`);for(const match of text.matchAll(/\{\{[\s\S]*?\}\}/g))if(match[0].includes('&amp;&amp;'))errors.push(`HTML-escaped WXML operator: ${file}: ${match[0]}`);}
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`Validated ${pages.length} page routes and component dependencies. Build bytes: ${walk(root).reduce((n,f)=>n+fs.statSync(f).size,0)}`);
