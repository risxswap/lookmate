import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const source=path.resolve('src');
function environment(handler=()=>({data:null,statusCode:200})){
 const stored=new Map(),calls=[],navigation=[];let logins=0;const modules=new Map();
 const wx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,v),removeStorageSync:k=>stored.delete(k),reLaunch:r=>navigation.push(r.url),navigateTo:r=>navigation.push(r.url),login:o=>{logins++;queueMicrotask(()=>o.success({code:'wechat-code'}));},request:o=>{calls.push(o);Promise.resolve().then(()=>handler(o)).then(r=>o.success(r),()=>o.fail({}));}};
 function load(name){const file=path.resolve(source,name.endsWith('.ts')?name:name+'.ts');if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{wx,getCurrentPages:()=>[{route:"pages/home/index"}],console,Date,setTimeout,clearTimeout,setInterval,clearInterval,Uint8Array})(spec=>load(path.relative(source,path.resolve(path.dirname(file),spec))),module,module.exports);return module.exports;}
 return {load,wx,stored,calls,navigation,get logins(){return logins;}};
}
const account=id=>({id,username:null,displayName:null,hasPassword:false,wechatBound:true,avatarFileId:null});
const authenticated=(id='A')=>({status:'AUTHENTICATED',token:'new',expiresAt:'2099-01-01T00:00:00Z',account:account(id)});
const expired={statusCode:401,data:{code:'UNAUTHENTICATED',message:'expired'}};
const response=data=>({statusCode:200,data:{data,requestId:'test'}});
function seed(env){env.load('lib/session').saveSession({token:'old',expiresAt:'2099-01-01T00:00:00Z',account:account('A')});}
test('fresh launch requires explicit login without wx.login',async()=>{const env=environment();await assert.rejects(env.load('lib/auth').ensureSession(),/请先登录/);assert.equal(env.logins,0);});
test('concurrent expired reads share recovery and retry safe reads',async()=>{const env=environment(o=>o.url.endsWith('/wechat/login')?response(authenticated()):o.header['X-Miniapp-Token']==='old'?expired:response({ok:true}));seed(env);env.load('lib/auth');const {request}=env.load('lib/request');const result=await Promise.all([request('/one'),request('/two')]);assert.equal(env.logins,1);assert.equal(result.length,2);assert.equal(env.calls.filter(c=>c.url.endsWith('/wechat/login')).length,1);});
test('expired write restores session but never replays write',async()=>{const env=environment(o=>o.url.endsWith('/wechat/login')?response(authenticated()):expired);seed(env);env.load('lib/auth');await assert.rejects(env.load('lib/request').request('/dresses',{method:'POST',body:{name:'shirt'}}),/未自动重试/);assert.equal(env.calls.filter(c=>c.url.endsWith('/dresses')).length,1);});
test('changed identity never fills previous account page with new account data',async()=>{const env=environment(o=>o.url.endsWith('/wechat/login')?response(authenticated('B')):expired);seed(env);env.load('lib/auth');await assert.rejects(env.load('lib/request').request('/profile'),/微信账号已变化/);assert.equal(env.calls.filter(c=>c.url.endsWith('/profile')).length,1);assert.deepEqual(env.navigation,['/pages/home/index']);});
test('failed recovery is blocked until manual retry',async()=>{const env=environment(o=>o.url.endsWith('/wechat/login')?{statusCode:503,data:{code:'WECHAT_UNAVAILABLE',message:'不可用'}}:expired);seed(env);env.load('lib/auth');const {request}=env.load('lib/request');await assert.rejects(request('/one'));await assert.rejects(request('/two'));assert.equal(env.logins,1);});
test('PATCH uses authenticated POST override and keeps idempotency header',async()=>{const env=environment(()=>response(null));seed(env);await env.load('lib/request').request('/dresses/5',{method:'PATCH',body:{name:'new'},headers:{'Idempotency-Key':'key'}});assert.equal(env.calls[0].method,'POST');assert.equal(env.calls[0].header['X-HTTP-Method-Override'],'PATCH');assert.equal(env.calls[0].header['Idempotency-Key'],'key');});
test('late page response cannot overwrite refreshed filters',async()=>{const env=environment();const {PagedList}=env.load('lib/pagination');const list=new PagedList(2);let release;const old=list.load(()=>new Promise(resolve=>release=resolve));await list.load(async()=>({items:[{id:'new'}],page:1,pageSize:2,total:1}),true);release({items:[{id:'old'}],page:1,pageSize:2,total:1});await old;assert.equal(list.items[0].id,'new');});
test('page failure preserves previous items and allows retry',async()=>{const env=environment();const {PagedList}=env.load('lib/pagination');const list=new PagedList(1);await list.load(async()=>({items:[{id:'1'}],page:1,pageSize:1,total:2}));await assert.rejects(list.load(async()=>{throw new Error('offline');}));assert.equal(list.items.length,1);assert.equal(list.page,1);assert.equal(list.loading,false);await list.load(async()=>({items:[{id:'2'}],page:2,pageSize:1,total:2}));assert.equal(list.items.length,2);});
test('draft storage stays isolated by account and mode',()=>{const env=environment();seed(env);const storage=env.load('lib/storage');storage.saveDraft('HAIRSTYLE',{requirements:'A hair'});storage.saveDraft('OUTFIT',{requirements:'A outfit'});env.load('lib/session').saveSession({...authenticated('B')});assert.equal(storage.readDraft('HAIRSTYLE'),null);env.load('lib/session').saveSession({...authenticated('A')});assert.equal(storage.readDraft('HAIRSTYLE').requirements,'A hair');storage.saveDraft('HAIRSTYLE',null);assert.equal(storage.readDraft('OUTFIT').requirements,'A outfit');});

test('requireAccount does not navigate twice after expired identity changes',async()=>{
 const env=environment(()=>response(authenticated('B')));seed(env);env.load('lib/session').saveSession({token:'old',expiresAt:'2000-01-01',account:account('A')});
 assert.equal(await env.load('lib/auth').requireAccount(),null);assert.deepEqual(env.navigation,['/pages/home/index']);
});
test('ordinary network failure stays on page and can be retried',async()=>{
 let offline=true;const env=environment(()=>{if(offline)throw new Error('offline');return response(account('A'));});seed(env);
 await assert.rejects(env.load('lib/auth').requireAccount(),/网络/);assert.deepEqual(env.navigation,[]);offline=false;
 assert.equal((await env.load('lib/auth').requireAccount()).id,'A');assert.equal(env.logins,0);
});
test('successful response from previous account is discarded',async()=>{
 let release;const env=environment(()=>new Promise(resolve=>release=resolve));seed(env);
 const pending=env.load('lib/request').request('/profile');await Promise.resolve();env.load('lib/session').saveSession(authenticated('B'));release(response(account('A')));
 await assert.rejects(pending,/账号已变化/);assert.equal(env.logins,0);
});
test('upload stops before completing old file when identity changes during cloud upload',async()=>{
 const env=environment(()=>response({fileId:'file-A',key:'A',uploadUrl:'https://upload.example',token:'upload-token'}));seed(env);
 env.wx.getImageInfo=o=>o.success({type:'jpeg'});let upload;
 env.wx.uploadFile=o=>{upload=o;};const pending=env.load('lib/files').uploadImage('/tmp/image',100);
 while(!upload)await Promise.resolve();env.load('lib/session').saveSession(authenticated('B'));upload.success({statusCode:200});
 await assert.rejects(pending,/账号已变化/);assert.equal(env.calls.length,1);assert.ok(env.calls[0].url.endsWith('/files/upload-intents'));
});
test('account change while choosing image prevents upload intent',async()=>{
 const env=environment();seed(env);let choose;env.wx.chooseMedia=o=>{choose=o;};
 const pending=env.load('lib/files').chooseAndUpload();env.load('lib/session').saveSession(authenticated('B'));choose.success({tempFiles:[{tempFilePath:'image',size:100}]});
 await assert.rejects(pending,/账号已变化/);assert.equal(env.calls.length,0);
});
test('account change during download discards image and never saves to album',async()=>{
 const env=environment();seed(env);let download;env.wx.downloadFile=o=>{download=o;};let saved=0;env.wx.saveImageToPhotosAlbum=()=>{saved++;};
 const pending=env.load('lib/files').saveImage('https://images.example/A.jpg');env.load('lib/session').saveSession(authenticated('B'));download.success({statusCode:200,tempFilePath:'old-account.jpg'});
 await assert.rejects(pending,/账号已变化/);assert.equal(saved,0);
});
