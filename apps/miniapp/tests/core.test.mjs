import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const source=path.resolve('src');
function environment(handler=()=>({data:null,statusCode:200}), pageRuntime = {}){
 const stored=new Map(),calls=[],navigation=[];let logins=0;const modules=new Map();
 const wx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,v),removeStorageSync:k=>stored.delete(k),reLaunch:r=>navigation.push(r.url),navigateTo:r=>navigation.push(r.url),login:o=>{logins++;queueMicrotask(()=>o.success({code:'wechat-code'}));},request:o=>{calls.push(o);Promise.resolve().then(()=>handler(o)).then(r=>o.success(r),()=>o.fail({}));}};
 function load(name){const file=path.resolve(source,name.endsWith('.ts')?name:name+'.ts');if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{wx,getCurrentPages:()=>[{route:"pages/home/index"}],console,Date,setTimeout,clearTimeout,setInterval,clearInterval,Uint8Array,...pageRuntime})(spec=>load(path.relative(source,path.resolve(path.dirname(file),spec))),module,module.exports);return module.exports;}
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

function passwordEnvironment(respond, hasPassword = true) {
 const pagePath = 'pages/change-password/index';
 const routes = [{route: 'pages/me/index'}, {route: pagePath}];
 const profile = {...account('A'), hasPassword};
 let definition;
 const env = environment(options => options.url.endsWith('/auth/me') ? response(profile) : respond(options), {
  Error, Page: value => { definition = value; }, getCurrentPages: () => routes
 });
 env.load('lib/session').saveSession({token: 'old', expiresAt: '2099-01-01T00:00:00Z', account: profile});
 const toasts = [];
 env.wx.showToast = options => toasts.push(options.title);
 env.wx.navigateBack = ({success}) => { env.navigation.push('back'); success(); };
 const mePage = () => makePage('pages/me/index');
 const passwordPage = () => makePage(pagePath);
 function makePage(name) {
  env.load(name);
  return {...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); }};
 }
 return {...env, mePage, passwordPage, toasts, pagePath};
}

function fillPasswords(page, confirmPassword = 'new password') {
 for (const [key, value] of Object.entries({currentPassword: 'old password', newPassword: 'new password', confirmPassword})) {
  page.field({currentTarget: {dataset: {key}}, detail: {value}});
 }
}

test('我的 links to the standalone password form; opening and leaving before saving makes no write', async () => {
 const env = passwordEnvironment(() => assert.fail('Unexpected write'));
 const template = fs.readFileSync(path.join(source, 'pages/me/index.wxml'), 'utf8');
 const entry = template.match(/<t-button[^>]*data-url="(\/pages\/change-password\/index)"[^>]*>/)?.[0];
 assert.match(entry, /wx:if="{{account.hasPassword}}".*bind:tap="go"/);
 assert.doesNotMatch(template, /<input\b/);
 assert.ok(JSON.parse(fs.readFileSync(path.join(source, 'app.json'), 'utf8')).pages.includes(env.pagePath));
 env.mePage().go({currentTarget: {dataset: {url: `/${env.pagePath}`}}});
 assert.deepEqual(env.navigation, [`/${env.pagePath}`]);
 const page = env.passwordPage();
 await page.onLoad();
 fillPasswords(page);
 page.onUnload();
 await page.savePassword();
 assert.deepEqual(env.calls.map(call => call.method), ['GET']);
});

test('password confirmation is required and must match exactly, and is omitted from the request', async () => {
 const env = passwordEnvironment(() => response(null));
 const page = env.passwordPage();
 await page.onLoad();
 fillPasswords(page, '');
 await page.savePassword();
 fillPasswords(page, 'new password ');
 await page.savePassword();
 assert.deepEqual(env.calls.map(call => call.method), ['GET']);

 fillPasswords(page);
 await page.savePassword();
 assert.deepEqual(env.calls.map(call => call.method), ['GET', 'POST']);
 assert.deepEqual(structuredClone(env.calls.at(-1).data), {currentPassword: 'old password', newPassword: 'new password'});
 assert.deepEqual(env.navigation, ['back']);
});

test('password failure retains inputs, and successful retry sends one write and returns to 我的', async () => {
 let finish;
 const env = passwordEnvironment(() => new Promise(resolve => { finish = resolve; }));
 const page = env.passwordPage();
 await page.onLoad();
 fillPasswords(page);
 const firstSave = page.savePassword();
 await page.savePassword();
 assert.equal(env.calls.filter(call => call.method === 'POST').length, 1);
 await Promise.resolve();
 finish({statusCode: 400, data: {code: 'CURRENT_PASSWORD_INCORRECT', message: '原密码错误'}});
 await firstSave;
 assert.equal(page.data.error, '原密码错误');
 assert.equal(page.data.currentPassword, 'old password');
 assert.equal(page.data.newPassword, 'new password');
 assert.equal(page.data.confirmPassword, 'new password');
 assert.deepEqual(env.navigation, []);

 const retry = page.savePassword();
 await Promise.resolve();
 finish(response(null));
 await retry;
 const write = env.calls.at(-1);
 assert.ok(write.url.endsWith('/auth/password'));
 assert.deepEqual(structuredClone(write.data), {currentPassword: 'old password', newPassword: 'new password'});
 assert.equal(page.data.currentPassword, '');
 assert.equal(page.data.newPassword, '');
 assert.equal(page.data.confirmPassword, '');
 assert.deepEqual(env.navigation, ['back']);
 assert.deepEqual(env.toasts, ['密码已修改']);
});

test('no-password account cannot submit, and a successful response after leaving does not navigate', async () => {
 const noPassword = passwordEnvironment(() => assert.fail('Unexpected write'), false);
 const readOnly = noPassword.passwordPage();
 await readOnly.onLoad();
 fillPasswords(readOnly);
 await readOnly.savePassword();
 assert.deepEqual(noPassword.calls.map(call => call.method), ['GET']);

 let finish;
 const env = passwordEnvironment(() => new Promise(resolve => { finish = resolve; }));
 const page = env.passwordPage();
 await page.onLoad();
 fillPasswords(page);
 const pending = page.savePassword();
 await Promise.resolve();
 page.onUnload();
 page.setData = () => assert.fail('Unexpected update after leaving the password page');
 finish(response(null));
 await pending;
 assert.deepEqual(env.navigation, []);
 assert.deepEqual(env.toasts, []);
});

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
test('upload reports a blocked WeChat domain and does not register the image', async () => {
 const env = environment(() => response({fileId: 'file-1', key: 'photo', uploadUrl: 'https://upload.qiniup.com', token: 'upload-token'}));
 seed(env);
 env.wx.getImageInfo = options => options.success({type: 'png'});
 env.wx.uploadFile = options => options.fail({errMsg: 'uploadFile:fail url not in domain list'});
 await assert.rejects(env.load('lib/files').uploadImage('/tmp/image.png', 100), /微信上传域名未配置/);
 assert.equal(env.calls.length, 1);
 assert.ok(env.calls[0].url.endsWith('/files/upload-intents'));
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

test('catalogue images request signed variants and never send the business token to image storage', async () => {
 const env = environment(options => response({url: `https://images.example/${options.url.endsWith('DISPLAY') ? 'display' : 'thumbnail'}.webp`, expiresAt: '2099-01-01'}));
 seed(env);
 const downloads = [];
 env.wx.downloadFile = options => { downloads.push(options); options.success({statusCode: 200, tempFilePath: `local-${downloads.length}`}); };
 const {displayUrl} = env.load('lib/files');
 const source = '/api/hairstyles/assets/v2/front.png';
 const thumbnail = await displayUrl(source);
 const display = await displayUrl(source, 'DISPLAY');
 assert.equal(await displayUrl(source), thumbnail);
 assert.notEqual(display, thumbnail);
 assert.deepEqual(env.calls.map(call => call.url), [
  'https://lookmate.labno3.com/api/hairstyles/assets/v2/front.png/access?variant=THUMBNAIL',
  'https://lookmate.labno3.com/api/hairstyles/assets/v2/front.png/access?variant=DISPLAY'
 ]);
 assert.ok(env.calls.every(call => call.header['X-Miniapp-Token'] === 'old'));
 assert.deepEqual(downloads.map(download => download.url), ['https://images.example/thumbnail.webp', 'https://images.example/display.webp']);
 assert.ok(downloads.every(download => Object.keys(download.header).length === 0));
 await displayUrl('/api/outfit-inspirations/assets/v1/outfit.png');
 assert.ok(env.calls.at(-1).url.includes('/outfit-inspirations/assets/v1/outfit.png/access?variant=THUMBNAIL'));
});

test('failed signed catalogue downloads can be retried without caching the failure', async () => {
 const env = environment(() => response({url: 'https://images.example/thumbnail.webp', expiresAt: '2099-01-01'}));
 seed(env);
 let fail = true;
 env.wx.downloadFile = options => fail ? options.fail({}) : options.success({statusCode: 200, tempFilePath: 'local-image'});
 const {displayUrl} = env.load('lib/files');
 await assert.rejects(displayUrl('/api/hairstyles/assets/v2/front.png'), /图片下载失败/);
 fail = false;
 assert.equal(await displayUrl('/api/hairstyles/assets/v2/front.png'), 'local-image');
 assert.equal(env.calls.length, 2);
});

test('catalogue access failure does not download the unprocessed original and permits retry', async () => {
 let available = false;
 const env = environment(() => available
  ? response({url: 'https://images.example/thumbnail.webp', expiresAt: '2099-01-01'})
  : {statusCode: 503, data: {code: 'STORAGE_UNAVAILABLE', message: '存储暂不可用'}});
 seed(env);
 let downloads = 0;
 env.wx.downloadFile = options => { downloads++; options.success({statusCode: 200, tempFilePath: 'local-image'}); };
 const {displayUrl} = env.load('lib/files');
 await assert.rejects(displayUrl('/api/hairstyles/assets/v2/front.png'), /存储暂不可用/);
 assert.equal(downloads, 0);
 available = true;
 assert.equal(await displayUrl('/api/hairstyles/assets/v2/front.png'), 'local-image');
 assert.equal(downloads, 1);
});

test('catalogue cache belongs to the original account and discards account changes during download', async () => {
 const env = environment(() => response({url: 'https://images.example/thumbnail.webp', expiresAt: '2099-01-01'}));
 seed(env);
 let download;
 env.wx.downloadFile = options => { download = options; };
 const {displayUrl} = env.load('lib/files');
 const pending = displayUrl('/api/hairstyles/assets/v2/front.png');
 while (!download) await Promise.resolve();
 env.load('lib/session').saveSession(authenticated('B'));
 download.success({statusCode: 200, tempFilePath: 'account-A-image'});
 await assert.rejects(pending, /账号已变化/);
 env.wx.downloadFile = options => options.success({statusCode: 200, tempFilePath: 'account-B-image'});
 assert.equal(await displayUrl('/api/hairstyles/assets/v2/front.png'), 'account-B-image');
 assert.equal(env.calls.length, 2);
});

test('file lists default to thumbnail access while explicit original display remains available', async () => {
 const env = environment(() => response({url: 'https://images.example/signed', expiresAt: '2099-01-01'}));
 seed(env);
 const {fileUrl, fileUrls, displayUrl} = env.load('lib/files');
 await fileUrls(['1', '1', '', '2']);
 assert.equal(env.calls.length, 2);
 assert.ok(env.calls.every(call => call.data.variant === 'THUMBNAIL'));
 await fileUrl('result');
 assert.equal(env.calls.at(-1).data.variant, 'DISPLAY');
 const calls = env.calls.length;
 assert.equal(await displayUrl('https://images.example/external-signed'), 'https://images.example/external-signed');
 assert.equal(env.calls.length, calls);
});

test('local file covers deduplicate concurrent requests and isolate variants and accounts', async () => {
 const env = environment(() => response({url: `https://images.example/signed-${env.calls.length}`, expiresAt: '2099-01-01'}));
 seed(env);
 const downloads = [];
 env.wx.downloadFile = options => { downloads.push(options); options.success({statusCode: 200, tempFilePath: `local-${downloads.length}`}); };
 const {fileImageUrl} = env.load('lib/files');
 const covers = await Promise.all([fileImageUrl('shared'), fileImageUrl('shared')]);
 assert.equal(covers[0], covers[1]);
 assert.equal(await fileImageUrl('shared'), covers[0]);
 assert.equal(env.calls.length, 1);
 assert.equal(downloads.length, 1);
 assert.deepEqual(Object.keys(downloads[0].header), []);
 assert.notEqual(await fileImageUrl('shared', 'DISPLAY'), covers[0]);
 env.load('lib/session').saveSession(authenticated('B'));
 assert.notEqual(await fileImageUrl('shared'), covers[0]);
 assert.equal(env.calls.length, 3);
});

test('local file cache evicts old entries and failed or invalidated covers can be downloaded again', async () => {
 let accessFails = true;
 const env = environment(() => accessFails
  ? {statusCode: 503, data: {code: 'STORAGE_UNAVAILABLE', message: '存储暂不可用'}}
  : response({url: 'https://images.example/signed', expiresAt: '2099-01-01'}));
 seed(env);
 let downloads = 0;
 let downloadFails = false;
 env.wx.downloadFile = options => {
  downloads++;
  if (downloadFails) options.fail({});
  else options.success({statusCode: 200, tempFilePath: `local-${downloads}`});
 };
 const {fileImageUrl, forgetFileImage} = env.load('lib/files');
 await assert.rejects(fileImageUrl('retry'), /存储暂不可用/);
 assert.equal(downloads, 0);
 accessFails = false;
 downloadFails = true;
 await assert.rejects(fileImageUrl('retry'), /图片下载失败/);
 downloadFails = false;
 const local = await fileImageUrl('retry');
 forgetFileImage('retry', 'stale-path');
 assert.equal(await fileImageUrl('retry'), local);
 forgetFileImage('retry', local);
 assert.notEqual(await fileImageUrl('retry'), local);
 for (let index = 0; index < 80; index++) await fileImageUrl(`other-${index}`);
 const requests = env.calls.length;
 await fileImageUrl('retry');
 assert.equal(env.calls.length, requests + 1);
});

test('local file cover downloads reject account changes and do not cache the discarded result', async () => {
 const env = environment(() => response({url: 'https://images.example/signed', expiresAt: '2099-01-01'}));
 seed(env);
 let download;
 env.wx.downloadFile = options => { download = options; };
 const {fileImageUrl} = env.load('lib/files');
 const pending = fileImageUrl('shared');
 while (!download) await Promise.resolve();
 env.load('lib/session').saveSession(authenticated('B'));
 download.success({statusCode: 200, tempFilePath: 'account-A'});
 await assert.rejects(pending, /账号已变化/);
 env.wx.downloadFile = options => options.success({statusCode: 200, tempFilePath: 'account-B'});
 assert.equal(await fileImageUrl('shared'), 'account-B');
 env.load('lib/session').saveSession(authenticated('A'));
 env.wx.downloadFile = options => options.success({statusCode: 200, tempFilePath: 'account-A-new'});
 assert.equal(await fileImageUrl('shared'), 'account-A-new');
 assert.equal(env.calls.length, 3);
});
