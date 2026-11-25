import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const source=path.resolve('src');
function environment(handler=()=>({data:null,statusCode:200}),runtime={}){
 const stored=new Map(),calls=[],navigation=[];let logins=0;let pageDefinition;const modules=new Map();
 const wx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,v),removeStorageSync:k=>stored.delete(k),reLaunch:r=>navigation.push(r.url),navigateTo:r=>navigation.push(r.url),login:o=>{logins++;queueMicrotask(()=>o.success({code:'wechat-code'}));},request:o=>{calls.push(o);Promise.resolve().then(()=>handler(o)).then(r=>o.success(r),()=>o.fail({}));}};
 function load(name){const file=path.resolve(source,name.endsWith('.ts')?name:name+'.ts');if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{wx,Page:value=>{pageDefinition=value;},getCurrentPages:()=>[{route:"pages/home/index"}],console,Error,Date,setTimeout,clearTimeout,setInterval,clearInterval,Uint8Array,...runtime})(spec=>load(path.relative(source,path.resolve(path.dirname(file),spec))),module,module.exports);return module.exports;}
 return {load,wx,stored,calls,navigation,get page(){return pageDefinition;},get logins(){return logins;}};
}
const account=id=>({id,username:null,displayName:null,hasPassword:false,wechatBound:true,avatarFileId:null});
const authenticated=(id='A')=>({status:'AUTHENTICATED',token:'new',expiresAt:'2099-01-01T00:00:00Z',account:account(id)});
const expired={statusCode:401,data:{code:'UNAUTHENTICATED',message:'expired'}};
const response=data=>({statusCode:200,data:{data,requestId:'test'}});
function seed(env){env.load('lib/session').saveSession({token:'old',expiresAt:'2099-01-01T00:00:00Z',account:account('A')});}

test('design submission success clears only submitted mode draft and pending key',async()=>{
 const env=environment(()=>response({taskId:'task-1',status:'QUEUED'}));seed(env);
 const store=env.load('lib/storage');store.saveDraft('HAIRSTYLE',{designType:'HAIRSTYLE',requirements:'hair'});store.saveDraft('OUTFIT',{requirements:'outfit'});
 const design=env.load('features/design');const pending={kind:'CREATE',accountId:'A',key:'same-key',input:{designType:'HAIRSTYLE',requirements:'hair'},previewToken:'preview'};
 await design.sendSubmission(pending);assert.equal(design.pendingSubmission(),null);assert.equal(store.readDraft('HAIRSTYLE'),null);assert.equal(store.readDraft('OUTFIT').requirements,'outfit');
 assert.equal(env.calls[0].header['Idempotency-Key'],'same-key');
});
test('unknown submission retains original key and recovery queries without reposting',async()=>{
 let offline=true;const env=environment(o=>{if(offline)throw new Error('offline');return response({taskId:'accepted',status:'QUEUED'});});seed(env);
 const design=env.load('features/design');const pending={kind:'CREATE',accountId:'A',key:'stable-key',input:{designType:'OVERALL'},previewToken:'preview'};
 await assert.rejects(design.sendSubmission(pending));assert.equal(design.pendingSubmission().key,'stable-key');offline=false;
 await design.sendSubmission(design.pendingSubmission(),true);assert.equal(env.calls[1].method,'GET');assert.ok(env.calls[1].url.endsWith('/designs/by-request/stable-key'));assert.equal(design.pendingSubmission(),null);
});
test('definite rejection preserves draft and clears pending, while idempotency conflict stays recoverable',async()=>{
 let conflict=false;const env=environment(()=>({statusCode:409,data:{code:conflict?'IDEMPOTENCY_CONFLICT':'PROFILE_VERSION_CONFLICT',message:'conflict'}}));seed(env);
 const store=env.load('lib/storage');store.saveDraft('OUTFIT',{requirements:'keep'});const design=env.load('features/design');const pending={kind:'CREATE',accountId:'A',key:'stable-key',input:{designType:'OUTFIT'},previewToken:'preview'};
 await assert.rejects(design.sendSubmission(pending));assert.equal(design.pendingSubmission(),null);assert.equal(store.readDraft('OUTFIT').requirements,'keep');conflict=true;
 await assert.rejects(design.sendSubmission(pending));assert.equal(design.pendingSubmission().key,'stable-key');
});
test('page actions preserve form and error after failed write',async()=>{
 const env=environment();seed(env);const page={data:{busy:false,form:'unsaved'},setData(values){Object.assign(this.data,values);}};
 await env.load('features/page').action(page,async()=>{throw new Error('save failed');});assert.equal(page.data.form,'unsaved');assert.equal(page.data.error,'save failed');assert.equal(page.data.busy,false);
});
test('page actions reject another account before running old form write',async()=>{
 const env=environment();seed(env);const page={data:{busy:false},setData(values){Object.assign(this.data,values);}};const {action}=env.load('features/page');
 await action(page,async()=>{});env.load('lib/session').saveSession(authenticated('B'));let writes=0;await action(page,async()=>{writes++;});assert.equal(writes,0);assert.deepEqual(env.navigation,['/pages/home/index']);
});
test('late page data from old owner cannot apply after account changes',async()=>{
 const env=environment();seed(env);const page={data:{busy:false,profile:'A'},setData(values){Object.assign(this.data,values);}};const {action}=env.load('features/page');
 let release;const wait=new Promise(resolve=>release=resolve);const work=action(page,async()=>{await wait;page.setData({profile:'late A'});});env.load('lib/session').saveSession(authenticated('B'));release();await work;assert.equal(page.data.profile,'A');
});

test('busy list filters do not change selection underneath an in-flight response',async()=>{
 for(const [name,method,key,oldValue,newValue] of [['design','mode','mode','HAIRSTYLE','OUTFIT'],['wardrobe','chooseCategory','categoryId','old','new'],['records','filter','status','FAILED','SUCCEEDED'],['favorites','filter','collectionId','old','new']]){
  const env=environment();seed(env);env.load(`pages/${name}/index`);const page=env.page;page.setData=values=>Object.assign(page.data,values);page.data.busy=true;page.data[key]=oldValue;
  await page[method]({currentTarget:{dataset:{id:newValue,key}},detail:{value:newValue}});assert.equal(page.data[key],oldValue,`${name} keeps in-flight filter`);assert.equal(env.calls.length,0);
 }
});

test('account-scoped list drops previous owner records before failed refresh or pagination',async()=>{
 const env=environment();seed(env);const {PagedList}=env.load('features/account-list');const list=new PagedList(1);
 await list.load(async()=>({items:[{id:'A-record'}],page:1,pageSize:1,total:2}));env.load('lib/session').saveSession(authenticated('B'));
 await assert.rejects(list.load(async()=>{throw new Error('offline');}));assert.equal(list.items.length,0);assert.equal(list.page,0);
 await list.load(async()=>({items:[{id:'B-record'}],page:1,pageSize:1,total:1}));assert.equal(list.items.length,1);assert.equal(list.items[0].id,'B-record');
});

test('personal photos load thumbnails and request the original only when previewing', async () => {
 const photo = {id: 'photo-1', fileId: 'file-1'};
 const brokenThumbnail = {id: 'photo-2', fileId: 'file-2'};
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/photos/slots')) return response({version: '1', portrait: photo, fullBody: brokenThumbnail, angles: {}, supplements: [], supplementTotal: 0});
  if (options.url.endsWith('/file-2/access') && options.data.variant === 'THUMBNAIL') throw new Error('thumbnail unavailable');
  return response({url: `https://images.example/${options.data.variant}`, expiresAt: '2099-01-01'});
 });
 seed(env);
 let preview;
 env.wx.previewImage = options => { preview = options; };
 env.load('pages/photos/index');
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 await page.load();
 assert.equal(page.data.rows[0].url, 'https://images.example/THUMBNAIL');
 assert.equal(page.data.rows[1].photo.id, 'photo-2');
 assert.equal(page.data.rows[1].url, '');
 assert.deepEqual(env.calls.filter(call => call.url.endsWith('/access')).map(call => call.data.variant), ['THUMBNAIL', 'THUMBNAIL']);
 assert.equal(preview, undefined);
 await page.preview({currentTarget: {dataset: {id: 'FULL_BODY'}}, detail: {}});
 assert.ok(env.calls.at(-1).url.endsWith('/file-2/access'));
 assert.equal(env.calls.at(-1).data.variant, 'DISPLAY');
 assert.deepEqual(Array.from(preview.urls), ['https://images.example/DISPLAY']);
});

test('personal photo menu writes only to the selected slot after explicit actions', async () => {
 const side = {id: 'side-photo', fileId: 'side-file'};
 const slots = {version: '7', portrait: null, fullBody: null, angles: {SIDE_FACE: side}, supplements: [side], supplementTotal: 1};
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/photos/slots')) return response(slots);
  if (options.url.endsWith('/side-file/access')) return response({url: 'https://images.example/side'});
  if (options.url.endsWith('/files/upload-intents')) return response({fileId: 'new-file', uploadUrl: 'https://uploads.example'});
  if (options.url.endsWith('/new-file/complete')) return response({status: 'TEMP'});
  if (options.url.endsWith('/photos/side-photo')) return response(null);
  throw new Error(`Unexpected request ${options.url}`);
 });
 seed(env);
 let menuIndex = null;
 let confirmed = false;
 let confirmationCount = 0;
 env.wx.showActionSheet = options => {
  assert.deepEqual(Array.from(options.itemList), ['更换照片', '删除照片']);
  if (menuIndex === null) options.fail({errMsg: 'cancel'});
  else options.success({tapIndex: menuIndex});
 };
 env.wx.showModal = options => {
  confirmationCount++;
  options.success({confirm: confirmed});
 };
 env.wx.chooseMedia = options => options.success({tempFiles: [{tempFilePath: 'photo.jpg', size: 100}]});
 env.wx.getImageInfo = options => options.success({type: 'jpg'});
 env.wx.uploadFile = options => options.success({statusCode: 200});
 env.wx.showToast = () => {};
 env.load('pages/photos/index');
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 await page.load();
 const event = id => ({currentTarget: {dataset: {id}}, detail: {}});
 const writes = () => env.calls.filter(call => call.url.includes('/photos/') && call.method !== 'GET');

 await page.photoMenu(event('SIDE_FACE'));
 assert.equal(confirmationCount, 0);
 assert.equal(writes().length, 0);

 menuIndex = 1;
 await page.photoMenu(event('SIDE_FACE'));
 assert.equal(confirmationCount, 1);
 assert.equal(writes().length, 0);

 menuIndex = 0;
 await page.photoMenu(event('SIDE_FACE'));
 assert.equal(writes()[0].method, 'POST');
 assert.deepEqual({...writes()[0].data}, {version: '7', fileId: 'new-file', slot: 'SUPPLEMENT', angle: 'SIDE_FACE', replacePhotoId: 'side-photo'});

 await page.upload(event('PORTRAIT'));
 assert.deepEqual({...writes()[1].data}, {version: '7', fileId: 'new-file', slot: 'PORTRAIT'});

 menuIndex = 1;
 confirmed = true;
 await page.photoMenu(event('SIDE_FACE'));
 assert.equal(confirmationCount, 2);
 assert.equal(writes()[2].method, 'DELETE');
 assert.ok(writes()[2].url.endsWith('/photos/side-photo'));
 assert.deepEqual({...writes()[2].data}, {version: '7'});
});

test('clothing recognition edits target the selected photo and keep the unsaved clothing form', async () => {
 const first = {id: '1', fileId: 'file-1', recognitionId: 'job', version: '1', effectiveFeatures: {description: '正面'}};
 const second = {id: '2', fileId: 'file-2', recognitionId: 'job', version: '7', effectiveFeatures: {description: '侧面'}};
 const original = {id: '10', name: '旧名称', images: [first, second], recognition: {status: 'SUCCEEDED'}};
 let rejected = true;
 const env = environment(() => rejected
  ? {statusCode: 400, data: {code: 'VALIDATION_ERROR', message: '描述过长'}}
  : response({...original, images: [first, {...second, version: '8', effectiveFeatures: {description: '新描述'}}]}));
 seed(env);
 env.wx.showActionSheet = options => options.success({tapIndex: options.itemList.indexOf('查看识别')});
 env.wx.showToast = () => {};
 env.load('pages/dress-edit/index');
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 const draftImages = [first, second].map(image => ({...image, url: `/test/${image.fileId}`}));
 page.setData({dressId: '10', dress: original, name: '未保存的新名称', images: draftImages});

 await page.photoMenu({currentTarget: {dataset: {id: 'file-2'}}});
 assert.equal(page.data.recognitionVisible, true);
 assert.equal(page.data.recognitionEditing, false);
 assert.equal(page.data.recognitionThumb, '/test/file-2');
 assert.equal(page.data.features.find(row => row.key === 'description').text, '侧面');
 page.beginRecognitionEdit();
 page.changeFeature({detail: {value: '1'}});
 assert.equal(page.data.featureValue, '侧面');
 page.setData({featureValue: '新描述'});

 const save = {currentTarget: {dataset: {}}};
 await page.saveFeature(save);
 assert.equal(page.data.recognitionEditError, '描述过长');
 assert.equal(page.data.featureValue, '新描述');
 assert.equal(page.data.recognitionEditing, true);
 rejected = false;
 await page.saveFeature(save);
 assert.ok(env.calls.every(call => call.url.endsWith('/dresses/10/images/2')));
 assert.equal(env.calls[1].data.version, '7');
 assert.equal(env.calls[1].data.manualFeatures.description, '新描述');
 assert.equal(page.data.recognitionEditing, false);
 assert.equal(page.data.features.find(row => row.key === 'description').text, '新描述');
 assert.equal(page.data.name, '未保存的新名称');
 assert.equal(page.data.images, draftImages);
});

function wardrobeEnvironment({dresses = [], outfits = [], total = dresses.length, loadCategories = () => [], failPage, failImage, pageName = 'wardrobe'} = {}) {
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/dresses/categories')) return response(loadCategories());
  if (options.url.includes('/outfit-groups?')) return response({items: [], page: 1, pageSize: 20, total: 0});
  if (options.url.includes('/dresses?') || options.url.includes('/outfits?')) {
   const params = new URL(options.url).searchParams;
   const page = Number(params.get('page'));
   if (failPage?.(page, params)) throw new Error('offline');
   const items = options.url.includes('/dresses?') ? dresses : outfits;
   if (params.get('categoryId')) {
    const matches = items.filter(item => item.categoryId === params.get('categoryId'));
    return response({items: matches.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: matches.length});
   }
   return response({items: items.slice((page - 1) * 20, page * 20), page, pageSize: 20, total});
  }
  if (options.url.endsWith('/access')) return response({url: `${options.url}?signature=${env.calls.length}`, expiresAt: '2099-01-01'});
  throw new Error(`Unexpected request ${options.url}`);
 });
 seed(env);
 const downloads = [];
 env.wx.downloadFile = options => {
  downloads.push(options);
  if (failImage?.(options.url)) options.fail({});
  else options.success({statusCode: 200, tempFilePath: `local-cover-${downloads.length}`});
 };
 env.load(`pages/${pageName}/index`);
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 return {env, page, downloads};
}

const wardrobeDress = id => ({id: String(id), name: `衣物 ${id}`, images: [{fileId: `file-${id}`}], categoryId: null});

test('wardrobe reports an invalid category response and reloads the actual list on retry', async () => {
 const category = {id: 'tops', code: 'TOP', name: '上装', sortOrder: 10};
 let categories;
 const {page} = wardrobeEnvironment({
  dresses: [{...wardrobeDress(1), categoryId: category.id}],
  loadCategories: () => categories
 });

 await page.load();
 assert.equal(page.data.error, '衣物分类加载失败，请重新加载');
 assert.equal(page.data.categories.length, 0);
 assert.equal(page.data.busy, false);

 categories = [category];
 await page.load();
 assert.equal(page.data.error, '');
 assert.equal(page.data.total, 1);
 assert.equal(page.data.items[0].metaLabel, category.name);
 assert.equal(page.data.items[0].cover, 'local-cover-1');
});

test('wardrobe filters on the server and clears the previous query even if the new first page fails', async () => {
 const bottom = {id: 'bottom', name: '下装'};
 const skirt = {id: 'skirt', name: '连衣裙'};
 let failFilter = true;
 const {env, page} = wardrobeEnvironment({
  dresses: [
   {...wardrobeDress(1), name: '连衣裙', color: '白色', categoryId: skirt.id},
   {...wardrobeDress(2), name: '牛仔裤', color: '蓝色', categoryId: bottom.id}
  ],
  loadCategories: () => [bottom, skirt],
  failPage: (_, params) => failFilter && params.get('categoryId') === bottom.id
 });
 const choose = id => page.chooseCategory({currentTarget: {dataset: {id}}});

 await page.load();
 assert.equal(page.data.items[0].metaLabel, '白色');
 const changing = choose(bottom.id);
 assert.equal(page.data.items.length, 0);
 assert.equal(page.data.total, 0);
 await changing;
 assert.ok(page.data.error);
 assert.equal(page.data.items.length, 0);
 failFilter = false;
 await page.retry();
 assert.equal(page.data.total, 1);
 assert.equal(page.data.items[0].metaLabel, '蓝色 · 下装');
 const listRequest = env.calls.filter(call => call.url.includes('/dresses?')).at(-1);
 assert.equal(new URL(listRequest.url).searchParams.get('page'), '1');
 assert.equal(new URL(listRequest.url).searchParams.get('categoryId'), bottom.id);
 const calls = env.calls.length;
 await choose(bottom.id);
 assert.equal(env.calls.length, calls);
 await choose('');
 assert.equal(page.data.total, 2);
 assert.equal(env.calls.length, calls + 1);
 assert.equal(env.calls.filter(call => call.url.endsWith('/dresses/categories')).length, 1);
});

test('wardrobe retries an append without discarding the first twenty items', async () => {
 let failed = true;
 const dresses = Array.from({length: 21}, (_, index) => wardrobeDress(index));
 const {env, page} = wardrobeEnvironment({dresses, failPage: page => page === 2 && failed});
 await page.load();
 await page.more();
 assert.ok(page.data.error);
 assert.equal(page.data.items.length, 20);
 failed = false;
 await page.retry();
 assert.equal(page.data.items.length, 21);
 assert.equal(page.data.error, '');
 const pages = env.calls.filter(call => call.url.includes('/dresses?')).map(call => new URL(call.url).searchParams.get('page'));
 assert.deepEqual(pages, ['1', '2', '2']);
});

test('wardrobe reaching the end preserves covers without requesting access again', async () => {
 const {env, page} = wardrobeEnvironment({dresses: [wardrobeDress(1)]});
 await page.load();
 assert.equal(page.data.items.length, 1);
 const cover = page.data.items[0].cover;
 const calls = env.calls.length;
 await page.more();
 await page.more();
 assert.equal(page.data.hasMore, false);
 assert.equal(env.calls.length, calls);
 assert.equal(page.data.items[0].cover, cover);
});

test('wardrobe appending and refreshing over the cache limit preserves displayed local covers', async () => {
 const dresses = Array.from({length: 101}, (_, index) => wardrobeDress(index));
 const {env, page, downloads} = wardrobeEnvironment({dresses});
 await page.load();
 const firstCover = page.data.items[0].cover;
 assert.match(firstCover, /^local-cover-/);
 while (page.data.hasMore) {
  const previous = page.data.items.map(item => item.cover);
  await page.more();
  assert.deepEqual(page.data.items.slice(0, previous.length).map(item => item.cover), previous);
 }
 assert.equal(downloads.length, dresses.length);
 const accesses = env.calls.filter(call => call.url.endsWith('/access')).length;
 await page.load();
 assert.equal(page.data.items.length, 20);
 assert.equal(page.data.items[0].cover, firstCover);
 assert.equal(downloads.length, dresses.length);
 assert.equal(env.calls.filter(call => call.url.endsWith('/access')).length, accesses);
});

test('wardrobe image failures preserve list metadata and successful covers until refresh retries', async () => {
 let failed = true;
 const {page, downloads} = wardrobeEnvironment({dresses: [wardrobeDress(1), wardrobeDress(2)], failImage: url => failed && url.includes('/file-2/')});
 await page.load();
 assert.equal(page.data.items.length, 2);
 assert.equal(page.data.total, 2);
 assert.equal(page.data.error, '');
 assert.ok(page.data.imageWarning);
 const successfulCover = page.data.items[0].cover;
 assert.ok(successfulCover);
 assert.equal(page.data.items[1].cover, '');
 failed = false;
 await page.load();
 assert.equal(downloads.length, 3);
 assert.equal(page.data.items[0].cover, successfulCover);
 assert.ok(page.data.items[1].cover);
 assert.equal(page.data.imageWarning, '');
 const oldCover = page.data.items[1].cover;
 page.imageError({currentTarget: {dataset: {kind: 'items', id: '2', fileId: 'file-2', cover: oldCover}}});
 assert.equal(page.data.items[0].cover, successfulCover);
 assert.equal(page.data.items[1].cover, '');
 await page.load();
 assert.equal(downloads.length, 4);
 assert.notEqual(page.data.items[1].cover, oldCover);
 const updatedCover = page.data.items[1].cover;
 page.imageError({currentTarget: {dataset: {kind: 'items', id: '2', fileId: 'file-2', cover: oldCover}}});
 assert.equal(page.data.items[1].cover, updatedCover);
});

test('wardrobe first-page failure remains retryable through load more', async () => {
 let failed = true;
 const {page} = wardrobeEnvironment({dresses: [wardrobeDress(1)], failPage: () => failed});
 await page.load();
 assert.equal(page.data.items.length, 0);
 assert.ok(page.data.error);
 failed = false;
 await page.more();
 assert.equal(page.data.items.length, 1);
 assert.equal(page.data.error, '');
});

test('wardrobe outfit covers share local images and do not reload on refresh or reaching the end', async () => {
 const outfit = {id: 'outfit-1', name: '搭配', sourceOutputFileId: 'file-1', items: [{dressName: '上衣', imageFileIds: ['file-2']}], scenes: ['日常']};
 const {env, page, downloads} = wardrobeEnvironment({dresses: [wardrobeDress(1)], outfits: [outfit], total: 1});
 await page.load();
 const clothesCover = page.data.items[0].cover;
 await page.outfits();
 assert.equal(page.data.outfits[0].coverParts.length, 1);
 assert.equal(page.data.outfits[0].coverParts[0].url, clothesCover);
 assert.equal(page.data.outfits[0].scenesText, '日常');
 await page.load();
 const calls = env.calls.length;
 await page.more();
 assert.equal(env.calls.length, calls);
 assert.equal(downloads.length, 1);
 assert.equal(page.data.outfits[0].coverParts[0].url, clothesCover);
});

test('manual outfit covers use at most two distinct garments and recover individual missing parts', async () => {
 const outfit = {id: 'manual', items: [
  {imageFileIds: []}, {imageFileIds: ['coat', 'unused-side']}, {imageFileIds: ['coat']},
  {imageFileIds: ['jeans']}, {imageFileIds: ['unused-third']}
 ]};
 let failed = true;
 const {page, downloads} = wardrobeEnvironment({outfits: [outfit], total: 1, failImage: url => failed && url.includes('/jeans/')});
 await page.outfits();
 const parts = () => Array.from(page.data.outfits[0].coverParts, part => part.fileId);
 assert.deepEqual(parts(), ['coat']);
 assert.equal(downloads.length, 2);
 const coat = page.data.outfits[0].coverParts[0].url;
 failed = false;
 await page.load();
 assert.deepEqual(parts(), ['coat', 'jeans']);
 assert.equal(downloads.length, 3);
 const error = (fileId, cover) => page.imageError({currentTarget: {dataset: {kind: 'outfits', id: 'manual', fileId, cover}}});
 error('coat', coat);
 assert.deepEqual(parts(), ['jeans']);
 error('jeans', page.data.outfits[0].coverParts[0].url);
 assert.deepEqual(parts(), []);
 await page.load();
 error('coat', coat);
 assert.deepEqual(parts(), ['coat', 'jeans']);
});

test('wardrobe drops old-account image results during download', async () => {
 const {env, page} = wardrobeEnvironment({dresses: [wardrobeDress(1)]});
 let download;
 env.wx.downloadFile = options => { download = options; };
 const pending = page.load();
 while (!download) await Promise.resolve();
 env.load('lib/session').saveSession(authenticated('B'));
 download.success({statusCode: 200, tempFilePath: 'account-A-local'});
 await pending;
 assert.equal(page.data.items.length, 0);
 assert.equal(page.data.coverAccountId, '');
 assert.ok(env.navigation.includes('/pages/home/index'));
});

test('wardrobe image cards disable whole-card opacity hover feedback', () => {
 const template = fs.readFileSync(path.resolve(source, 'pages/wardrobe/index.wxml'), 'utf8');
 const cards = template.match(/<t-button[^>]*t-class="lm-custom-root wardrobe-item"[^>]*>/g);
 assert.equal(cards.length, 2);
 assert.ok(cards.every(card => card.includes('hover-class="none"')));
});

const savedOutfit = id => ({id: String(id), name: `搭配 ${id}`, sourceOutputFileId: `file-${id}`, items: [{dressName: '上衣', imageFileIds: [`dress-${id}`]}], scenes: ['日常']});
const outfitsEnvironment = options => wardrobeEnvironment({...options, pageName: 'outfits', total: options.outfits.length});

test('outfits list reaching the end preserves its cover without requesting access again', async () => {
 const {env, page} = outfitsEnvironment({outfits: [savedOutfit(1)]});
 await page.load(true);
 const cover = page.data.items[0].cover;
 const accesses = env.calls.filter(call => call.url.endsWith('/access')).length;
 const calls = env.calls.length;
 await page.load();
 await page.load();
 assert.equal(env.calls.filter(call => call.url.endsWith('/access')).length, accesses);
 assert.equal(env.calls.length, calls);
 assert.equal(page.data.items[0].cover, cover);
});

test('outfits list appends only new covers and reuses them after refresh and filtering over the cache limit', async () => {
 const outfits = Array.from({length: 101}, (_, index) => savedOutfit(index));
 const {env, page, downloads} = outfitsEnvironment({outfits});
 await page.load(true);
 const firstCover = page.data.items[0].cover;
 assert.match(firstCover, /^local-cover-/);
 while (page.data.more) {
  const previous = page.data.items.map(item => item.cover);
  await page.load();
  assert.deepEqual(page.data.items.slice(0, previous.length).map(item => item.cover), previous);
 }
 assert.equal(downloads.length, outfits.length);
 page.setData({groupId: 'commute', scene: '通勤'});
 await page.refresh();
 assert.equal(page.data.items[0].cover, firstCover);
 assert.equal(downloads.length, outfits.length);
 const listRequest = env.calls.filter(call => call.url.includes('/outfits?')).at(-1);
 const query = new URL(listRequest.url).searchParams;
 assert.equal(query.get('page'), '1');
 assert.equal(query.get('groupId'), 'commute');
 assert.equal(query.get('scene'), '通勤');
});

test('outfits list isolates failed images and retries them without changing successful covers', async () => {
 let failed = true;
 const {page, downloads} = outfitsEnvironment({outfits: [savedOutfit(1), savedOutfit(2)], failImage: url => failed && url.includes('/file-2/')});
 await page.load(true);
 assert.equal(page.data.items.length, 2);
 assert.equal(page.data.total, 2);
 assert.equal(page.data.error, '');
 assert.ok(page.data.imageWarning);
 const successfulCover = page.data.items[0].cover;
 assert.ok(successfulCover);
 assert.equal(page.data.items[1].cover, '');
 failed = false;
 await page.refresh();
 assert.equal(downloads.length, 3);
 assert.equal(page.data.items[0].cover, successfulCover);
 assert.ok(page.data.items[1].cover);
 assert.equal(page.data.imageWarning, '');
 const oldCover = page.data.items[1].cover;
 page.imageError({currentTarget: {dataset: {id: '2', fileId: 'file-2', cover: oldCover}}});
 await page.load(true);
 assert.equal(downloads.length, 4);
 assert.equal(page.data.items[0].cover, successfulCover);
 const newCover = page.data.items[1].cover;
 assert.notEqual(newCover, oldCover);
 page.imageError({currentTarget: {dataset: {id: '2', fileId: 'file-2', cover: oldCover}}});
 assert.equal(page.data.items[1].cover, newCover);
});

test('outfits list first-page and later-page failures remain retryable', async () => {
 let failed = true;
 const {page} = outfitsEnvironment({outfits: Array.from({length: 21}, (_, index) => savedOutfit(index)), failPage: () => failed});
 await page.load(true);
 assert.equal(page.data.items.length, 0);
 assert.ok(page.data.error);
 failed = false;
 await page.load();
 assert.equal(page.data.items.length, 20);
 const firstCover = page.data.items[0].cover;
 failed = true;
 await page.load();
 assert.equal(page.data.items.length, 20);
 assert.equal(page.data.items[0].cover, firstCover);
 failed = false;
 await page.load();
 assert.equal(page.data.items.length, 21);
 assert.equal(page.data.error, '');
 failed = true;
 await page.load(true);
 assert.equal(page.data.items.length, 21);
 assert.ok(page.data.error);
 failed = false;
 await page.load();
 assert.equal(page.data.items.length, 20);
 assert.equal(page.data.items[0].cover, firstCover);
 assert.equal(page.data.error, '');
});

test('outfits list rejects old-account image results during download', async () => {
 const {env, page} = outfitsEnvironment({outfits: [savedOutfit(1)]});
 let download;
 env.wx.downloadFile = options => { download = options; };
 const pending = page.load(true);
 while (!download) await Promise.resolve();
 env.load('lib/session').saveSession(authenticated('B'));
 download.success({statusCode: 200, tempFilePath: 'account-A-local'});
 await pending;
 assert.equal(page.data.items.length, 0);
 assert.equal(page.data.coverAccountId, '');
 assert.ok(env.navigation.includes('/pages/home/index'));
});

function homeEnvironment({outfits, failImage, plans = [], workspace = () => ({activeTask:null}), runtime = {}} = {}) {
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.includes('/outfit-plans?')) return response({items: plans, page: 1, pageSize: 5, total: plans.length});
  if (options.url.includes('/outfits?')) return response({items: outfits, page: 1, pageSize: 4, total: outfits.length});
  if (options.url.endsWith('/workspace')) return response(workspace());
  if (options.url.endsWith('/access')) return response({url: `${options.url}?signature=${env.calls.length}`, expiresAt: '2099-01-01'});
  throw new Error(`Unexpected request ${options.url}`);
 }, runtime);
 seed(env);
 const downloads = [];
 env.wx.downloadFile = options => {
  downloads.push(options);
  if (failImage?.(options.url)) options.fail({});
  else options.success({statusCode: 200, tempFilePath: `local-home-${downloads.length}`});
 };
 env.load('pages/home/index');
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 return {env, page, downloads};
}

test('home outfit covers remain local and stable across repeated refreshes and cache eviction', async () => {
 const {env, page, downloads} = homeEnvironment({outfits: [savedOutfit(1)]});
 await page.refresh();
 const cover = page.data.outfits[0].cover;
 const accesses = env.calls.filter(call => call.url.endsWith('/access')).length;
 await page.refresh();
 await page.refresh();
 assert.equal(env.calls.filter(call => call.url.endsWith('/access')).length, accesses);
 assert.equal(page.data.outfits[0].cover, cover);
 assert.match(cover, /^local-home-/);
 const {fileImageUrl} = env.load('lib/files');
 for (let index = 0; index < 80; index++) await fileImageUrl(`other-${index}`);
 const count = downloads.length;
 await page.refresh();
 assert.equal(downloads.length, count);
 assert.equal(page.data.outfits[0].cover, cover);
});

test('home outfit image failures retain cards and retry without clearing successful or reordered covers', async () => {
 let failed = true;
 const outfits = [savedOutfit(1), savedOutfit(2)];
 const {page, downloads} = homeEnvironment({outfits, failImage: url => failed && url.includes('/file-2/')});
 await page.refresh();
 assert.equal(page.data.loaded, true);
 assert.equal(page.data.error, '');
 assert.equal(page.data.outfits.length, 2);
 assert.equal(page.data.outfits[1].name, '搭配 2');
 assert.ok(page.data.outfitImageWarning);
 const firstCover = page.data.outfits[0].cover;
 assert.ok(firstCover);
 assert.equal(page.data.outfits[1].cover, '');
 failed = false;
 await page.refresh();
 assert.equal(downloads.length, 3);
 assert.equal(page.data.outfits[0].cover, firstCover);
 assert.equal(page.data.outfitImageWarning, '');
 const oldCover = page.data.outfits[1].cover;
 outfits.reverse();
 await page.refresh();
 page.outfitImageError({currentTarget: {dataset: {id: '2', fileId: 'file-2', cover: oldCover, index: 1}}});
 assert.equal(page.data.outfits[0].cover, '');
 assert.equal(page.data.outfits[1].cover, firstCover);
 await page.refresh();
 assert.equal(downloads.length, 4);
 const newCover = page.data.outfits[0].cover;
 assert.notEqual(newCover, oldCover);
 page.outfitImageError({currentTarget: {dataset: {id: '2', fileId: 'file-2', cover: oldCover, index: 0}}});
 assert.equal(page.data.outfits[0].cover, newCover);
});

test('home outfit covers reject an account change during download', async () => {
 const {env, page} = homeEnvironment({outfits: [savedOutfit(1)]});
 let download;
 env.wx.downloadFile = options => { download = options; };
 const pending = page.refresh();
 while (!download) await Promise.resolve();
 env.load('lib/session').saveSession(authenticated('B'));
 download.success({statusCode: 200, tempFilePath: 'account-A-local'});
 await pending;
 assert.equal(page.data.outfits.length, 0);
 assert.equal(page.data.loaded, false);
 assert.equal(page.data.coverAccountId, '');
 assert.ok(env.navigation.includes('/pages/home/index'));
});

test('editing an existing dress sends only changed fields and preserves the identity of retained images', async () => {
 const original = {id:'10', name:'衬衫', categoryId:'1', color:'白', notes:null, seasons:[], images:[
  {id:'17', fileId:'19'}, {id:'20', fileId:'21'}
 ]};
 let saved = original;
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/dresses/categories')) return response([{id:'1',name:'上衣'}]);
  if (options.url.endsWith('/access')) return response({url:'local-image'});
  if (options.url.endsWith('/dresses/10') && options.method === 'GET') return response(saved);
  assert.equal(options.header['X-HTTP-Method-Override'], 'PATCH');
  const {images, ...fields} = options.data;
  if (images) assert.ok(images.every(image => Object.keys(image).length === 1));
  saved = {...saved, ...fields, images: images ? images.map(image =>
   image.imageId ? saved.images.find(old => old.id === image.imageId) : {id:'30',fileId:image.fileId}) : saved.images};
  return response(saved);
 });
 seed(env);
 env.wx.showToast = () => {};
 env.load('pages/dress-edit/index');
 const page = env.page;
 page.setData = values => Object.assign(page.data, values);
 page.setData({dressId:'10'});
 await page.load();
 page.setData({name:'白衬衫'});
 await page.save();
 const writes = () => env.calls.filter(call => call.header['X-HTTP-Method-Override'] === 'PATCH');
 assert.deepEqual(structuredClone(writes()[0].data), {name:'白衬衫'});
 assert.equal(page.data.error,'');
 page.setData({images:[page.data.images[1],{fileId:'31',url:'new'}],color:''});
 await page.save();
 assert.deepEqual(structuredClone(writes()[1].data), {color:null,images:[{imageId:'20'},{fileId:'31'}]});
 assert.deepEqual(Array.from(page.data.images, image => image.id), ['20','30']);
 await page.save();
 assert.equal(writes().length, 2);
});

test('outfit pagination uses the applied scene and retries a failed filter change from page one', async () => {
 let fail = false;
 const {env, page} = outfitsEnvironment({outfits:Array.from({length:42},(_,i)=>savedOutfit(i)),failPage:()=>fail});
 const requests = () => env.calls.filter(call=>call.url.includes('/outfits?')).map(call=>new URL(call.url).searchParams);
 await page.load(true);
 page.scene({detail:{value:'旅行'}});
 await page.load();
 assert.equal(requests().at(-1).get('page'),'2');
 assert.equal(requests().at(-1).get('scene'),null);
 fail = true;
 await page.applyScene();
 assert.ok(page.data.error);
 assert.equal(page.data.items.length,40);
 fail = false;
 await page.load();
 assert.equal(requests().at(-1).get('page'),'1');
 assert.equal(requests().at(-1).get('scene'),'旅行');
 assert.equal(page.data.items.length,20);
 await page.load();
 assert.equal(requests().at(-1).get('page'),'2');
 assert.equal(requests().at(-1).get('scene'),'旅行');
});

test('home keeps plans with a failed cover, polls only the workspace and reads only plans on date changes', async () => {
 const timers = new Map(); let timerId = 0;
 const runtime = {setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
 let activeTask = {id:'task',status:'PLANNING'};
 const {env,page} = homeEnvironment({
  plans:[{id:'plan',outfit:savedOutfit(2)}],outfits:[savedOutfit(1)],workspace:()=>({activeTask}),
  failImage:url=>url.includes('/file-2/'),runtime
 });
 const count = path => env.calls.filter(call => call.url.includes(path)).length;
 page.visible = true;
 await page.refresh();
 assert.equal(page.data.error,'');
 assert.equal(page.data.loaded,true);
 assert.equal(page.data.plans[0].cover,'');
 assert.equal(page.data.planImageWarning,true);
 assert.equal(page.data.outfits.length,1);
 assert.equal(page.data.active.id,'task');
 assert.equal(timers.size,1);
 const recheck = async () => {
  const run = timers.get(page.timer);
  assert.ok(run);
  timers.delete(page.timer);
  run();
  await new Promise(resolve=>setImmediate(resolve));
 };
 await recheck();
 assert.deepEqual([count('/workspace'),count('/outfit-plans?'),count('/outfits?')],[2,1,1]);
 await page.changeDate({detail:{value:'2026-12-10'}});
 assert.deepEqual([count('/workspace'),count('/outfit-plans?'),count('/outfits?')],[2,2,1]);
 const stale = timers.get(page.timer);
 page.onHide();
 stale();
 assert.equal(count('/workspace'),2);
 page.visible = true;
 await page.refresh();
 activeTask = null;
 await recheck();
 assert.equal(page.data.active,null);
 assert.equal(timers.size,0);
});

test('catalogue binderror evicts only the failed rendered path and retries without rereading the list', async () => {
 let downloads = 0;
 const env = environment(options => {
  if(options.url.endsWith('/auth/me')) return response(account('A'));
  if(options.url.includes('/hairstyles?')) return response({items:[{id:'hair',images:[{url:'/api/hairstyles/assets/v2/hair.png'}]}],page:1,pageSize:20,total:1});
  if(options.url.includes('/access?')) return response({url:'https://storage.example/hair'});
  throw Error(options.url);
 });
 seed(env);
 env.wx.downloadFile = options => options.success({statusCode:200,tempFilePath:'local-'+ ++downloads});
 env.load('pages/design/index');
 const page=env.page;
 page.setData=values=>Object.assign(page.data,values);
 await page.load();
 const event={currentTarget:{dataset:{id:'hair', mode:'HAIRSTYLE', cover:page.data.items[0].cover}}};
 page.imageError(event);
 assert.ok(page.data.imageWarning);
 await page.retryImages();
 assert.equal(downloads,2);
 assert.equal(page.data.items[0].cover,'local-2');
 assert.equal(env.calls.filter(call=>call.url.includes('/hairstyles?')).length,1);
 page.imageError(event);
 assert.equal(page.data.items[0].cover,'local-2');
 assert.equal(page.data.imageWarning,'');
});

test('home resumes exactly one workspace poll after returning during a pending date change', async () => {
 const timers = new Map();
 let next = 0;
 const runtime = {setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)};
 const {env,page} = homeEnvironment({outfits:[],workspace:()=>({activeTask:{id:'task',status:'PLANNING'}}),runtime});
 page.visible = true;
 await page.refresh();
 const stalePoll = timers.get(page.timer);
 let release;
 const originalRequest = env.wx.request;
 env.wx.request = options => {
  if (release || !options.url.includes('2026-12-10')) return originalRequest(options);
  release = () => originalRequest(options);
 };
 const change = page.changeDate({detail:{value:'2026-12-10'}});
 assert.ok(release);
 page.onHide();
 page.onShow();
 assert.equal(timers.size,0);
 release();
 await change;
 assert.equal(page.data.loaded,true);
 assert.equal(timers.size,1);
 const queries = () => env.calls.filter(call=>call.url.endsWith('/workspace')).length;
 assert.equal(queries(),2);
 stalePoll();
 assert.equal(queries(),2);
 const run = timers.get(page.timer);
 timers.delete(page.timer);
 run();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queries(),3);
 assert.equal(timers.size,1);
 page.onUnload();
 assert.equal(timers.size,0);
});

test('home discards the deferred return refresh if the session changes during a date request', async () => {
 const {env,page}=homeEnvironment({outfits:[],workspace:()=>({activeTask:{id:'A-task',status:'PLANNING'}})});
 page.visible = true;
 await page.refresh();
 let release;
 const originalRequest = env.wx.request;
 env.wx.request = options => { release = () => originalRequest(options); };
 const change = page.changeDate({detail:{value:'2026-12-11'}});
 page.onHide();
 env.load('lib/session').saveSession(authenticated('B'));
 page.onShow();
 release();
 await change;
 assert.equal(env.calls.filter(call=>call.url.endsWith('/workspace')).length,1);
 assert.equal(page.data.loaded,false);
 assert.ok(env.navigation.includes('/pages/home/index'));
 page.onUnload();
});

for (const name of ['records','calendar']) {
 test(name + ' retries page one for the new condition and keeps same-condition rows on failure', async () => {
  const requests = [];
  let fail = true;
  const env = environment(options => {
   const url = new URL(options.url);
   if (url.pathname.endsWith('/auth/me')) return response(account('A'));
   if (url.pathname.endsWith('/calendar')) return response({days:[]});
   const page = Number(url.searchParams.get('page'));
   const filter = url.searchParams.get(name === 'calendar' ? 'date' : 'status') || 'all';
   requests.push([filter,page]);
   if (fail && (filter === 'FAILED' || filter === '2026-11-25')) return {statusCode:503,data:{message:'稍后重试'}};
   const items = Array.from({length:20}, (_,i) => ({id:filter+'-'+(20*(page-1)+i),status:'FAILED'}));
   return response({page,pageSize:20,total:60,items});
  });
  seed(env);env.load('pages/'+name+'/index');
  const page=env.page;page.setData=d=>Object.assign(page.data,d);
  const list=name==='calendar'?'plans':'items';
  if(name==='calendar') {page.onLoad({date:'2026-11-24'});await page.refresh();}
  else {await page.load();}
  assert.equal(page.data[list].length,20);
  if(name==='calendar') await page.changeDate({detail:{value:'2026-11-25'}});
  else await page.filter({currentTarget:{dataset:{key:'status',id:'FAILED'}}});
  while(page.data.busy) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(page.data[list].length,0);
  assert.ok(page.data.error);
  fail=false;
  if(name==='calendar') await page.load(); else await page.more();
  const newKey=name==='calendar'?'2026-11-25':'FAILED';
  assert.deepEqual(requests.slice(-2),[[newKey,1],[newKey,1]]);
  assert.ok(page.data[list].every(row=>row.id.startsWith(newKey)));
  fail=true;
  if(name==='calendar') await page.load(); else await page.more();
  assert.ok(page.data.error);assert.equal(page.data[list].length,20);
  fail=false;
  await page.retry();
  assert.deepEqual(requests.slice(-2),[[newKey,2],[newKey,2]]);
  assert.equal(page.data[list].length,40);
  await page.more();
  assert.equal(page.data[list].length,60);
  if(name==='calendar') assert.equal(env.calls.filter(call=>new URL(call.url).pathname.endsWith('/calendar')).length,1);
  fail=true;
  if(name==='calendar') await page.refresh(); else await page.load();
  assert.ok(page.data.error);assert.equal(page.data[list].length,60);
  fail=false;
  await page.retry();
  assert.deepEqual(requests.slice(-2),[[newKey,1],[newKey,1]]);
  assert.equal(page.data[list].length,20);
 });
}

test('new dress shows field errors, keeps user input and becomes an existing dress after a successful save', async () => {
 const titles = [], scrolled = [];
 const categories = [{id:'1',name:'上装'},{id:'2',name:'下装'}];
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/dresses/categories')) return response(categories);
  if (options.url.endsWith('/files/upload-intents')) return response({fileId:'jeans-photo', key:'jeans', uploadUrl:'/test-upload', token:'test'});
  if (options.url.endsWith('/complete')) return response({status:'TEMP'});
  if (options.url.endsWith('/access')) return response({url:'local-photo'});
  assert.ok(options.url.endsWith('/dresses') && options.method === 'POST');
  return response({...options.data,id:'new-dress',images:[{id:'image-1',fileId:'jeans-photo'}]});
 });
 seed(env);
 env.wx.setNavigationBarTitle = event => titles.push(event.title);
 env.wx.nextTick = callback => callback();
 env.wx.pageScrollTo = event => scrolled.push(event.selector);
 env.wx.showToast = () => {};
 env.wx.chooseMedia = event => event.success({tempFiles:[{tempFilePath:'test.jpg',size:2000}]});
 env.wx.getImageInfo = event => event.success({type:'jpg'});
 env.wx.uploadFile = event => event.success({statusCode:200});
 env.load('pages/dress-edit/index');
 const page = env.page;
 page.setData = data => Object.assign(page.data, data);
 await page.onLoad({});
 assert.deepEqual(titles, ['添加衣物']);
 page.field({currentTarget:{dataset:{key:'notes'}},detail:{value:'保留这条备注'}});
 await page.save();
 assert.ok(Object.values(page.data.fieldErrors).every(Boolean));
 assert.equal(scrolled.at(-1), '#dress-photos');
 await page.add();
 assert.equal(page.data.fieldErrors.photos,'');
 await page.save();
 assert.equal(scrolled.at(-1), '#dress-name');
 page.field({currentTarget:{dataset:{key:'name'}},detail:{value:'牛仔裤'}});
 assert.equal(page.data.fieldErrors.name,'');
 await page.save();
 assert.equal(scrolled.at(-1), '#dress-category');
 page.category({detail:{value:'1'}});
 assert.equal(page.data.fieldErrors.category,'');
 assert.equal(page.data.categoryIndex,1);
 page.season({detail:{value:['SPRING','WINTER']}});
 assert.deepEqual(Array.from(page.data.seasonOptions.filter(option=>option.checked), option=>option.label),['春','冬']);
 assert.equal(env.calls.filter(call => call.url.endsWith('/dresses')).length,0);
 await page.save();
 assert.deepEqual(titles,['添加衣物','衣物详情']);
 assert.equal(page.data.dressId,'new-dress');
 assert.equal(page.data.notes,'保留这条备注');
 assert.equal(page.data.categoryIndex,1);
 assert.equal(page.data.saving,false);
});

test('dress photo picker respects remaining slots and cancel keeps the draft available', async () => {
 const env = environment();
 seed(env);
 const limits = [];
 env.wx.chooseMedia = options => {
  limits.push(options.count);
  options.fail({errMsg:'chooseMedia:fail cancel'});
 };
 env.load('pages/dress-edit/index');
 const page = env.page;
 page.setData = changes => Object.assign(page.data, changes);
 const photos = Array.from({length:8}, (_,i)=>({fileId:String(i),url:'photo-'+i}));
 page.setData({name:'原名称',images:photos.slice(0,7)});
 await page.add();
 assert.equal(page.data.images.length,7);
 assert.equal(page.data.error,'');
 assert.equal(page.data.name,'原名称');
 page.setData({images:photos});
 await page.add();
 assert.deepEqual(limits,[1]);
 assert.equal(env.calls.length,0);
});

test('dress load failure can be retried and a rejected save preserves the edit without a reload prompt', async () => {
 let failedLoad = true;
 const dress = {id:'10',name:'原名称',categoryId:'2',seasons:[],images:[{id:'11',fileId:'12'}]};
 const env = environment(options => {
  if (options.url.endsWith('/auth/me')) return response(account('A'));
  if (options.url.endsWith('/dresses/categories')) return response([{id:'1',name:'上衣'},{id:'2',name:'下装'}]);
  if (options.url.endsWith('/access')) return response({url:'image'});
  if (options.method === 'GET') {
   if (failedLoad) throw new Error('offline');
   return response(dress);
  }
  return {statusCode:400,data:{code:'VALIDATION_ERROR',message:'请修改后重试'}};
 });
 seed(env);
 const titles = [];
 env.wx.setNavigationBarTitle = event => titles.push(event.title);
 env.load('pages/dress-edit/index');
 const page = env.page;
 page.setData = changes => Object.assign(page.data, changes);
 await page.onLoad({id:'10'});
 assert.deepEqual(titles,['衣物详情']);
 assert.equal(page.data.loadFailed,true);
 failedLoad = false;
 await page.load();
 assert.equal(page.data.loadFailed,false);
 assert.equal(page.data.categoryIndex,1);
 page.field({currentTarget:{dataset:{key:'name'}},detail:{value:'新名称'}});
 await page.save();
 assert.equal(page.data.error,'请修改后重试');
 assert.equal(page.data.name,'新名称');
 assert.equal(page.data.loadFailed,false);
 assert.equal(page.data.saving,false);
});

test('dress form values and native controls are protected while a save is pending', async () => {
 const dress={id:'1',name:'原名称',categoryId:'1',color:null,notes:null,seasons:[],images:[{id:'1',fileId:'9'}]};
 let finish;
 const env=environment(options=>{
  assert.equal(options.header['X-HTTP-Method-Override'],'PATCH');
  return new Promise(resolve=>{finish=()=>resolve(response({...dress,...options.data}));});
 });
 seed(env);env.wx.showToast=()=>{};env.load('pages/dress-edit/index');
 const page=env.page;page.setData=d=>Object.assign(page.data,d);
 page.setData({categories:[{id:'1',name:'上衣'},{id:'2',name:'外套'}]});
 page.showDress(dress,{'9':'local-9'});page.setData({name:'提交名称'});
 const save=page.save();
 while(!finish) await Promise.resolve();
 assert.equal(page.data.saving,true);
 await page.save();
 assert.equal(env.calls.length,1);
 page.field({detail:{value:'后输入'},currentTarget:{dataset:{key:'name'}}});
 page.category({detail:{value:'1'}});page.season({detail:{value:['SPRING']}});
 assert.equal(page.data.name,'提交名称');assert.equal(page.data.categoryId,'1');assert.equal(page.data.seasons.length,0);
 finish();await save;
 assert.equal(page.data.name,'提交名称');assert.equal(page.data.busy,false);assert.equal(page.data.saving,false);
 const template=fs.readFileSync(path.join(source,'pages/dress-edit/index.wxml'),'utf8');
 const controls=template.match(/<(?:input|picker|textarea|checkbox)\b[^>]*(?:bindinput="field"|bindchange="category"|class="season-checkbox")[^>]*>/g);
 assert.equal(controls.length,6);
 for(const tag of controls) assert.equal(tag.match(/disabled="{{busy}}"/g)?.length,1);
});

for(const scenario of [
 {name:'衣物',page:'outfit-detail',path:'dresses',rows:'dresses',request:'loadDresses',retry:'retryDressCovers',renderError:'dressCoverFailed',error:'dressPageError',more:'moreDresses'},
 {name:'照片',page:'outfit-detail',path:'photos',rows:'photos',request:'loadPhotos',retry:'retryPhotoCovers',renderError:'photoCoverFailed',error:'photoPageError',more:'morePhotos'},
 {name:'日历搭配',page:'calendar',path:'outfits',rows:'outfits',request:'loadOutfits',retry:'retryOutfitCovers',renderError:'outfitCoverFailed',error:'outfitPageError',more:'moreOutfits'}
]){
 test(scenario.name+' picker retries its own failed first or subsequent data page',async()=>{
  let fail = true;
  const pages = [];
  const env = environment(options => {
   const url = new URL(options.url);
   assert.ok(url.pathname.endsWith('/'+scenario.path));
   const page = Number(url.searchParams.get('page'));
   pages.push(page);
   if(fail) return {statusCode:503,data:{message:'请重试'}};
   const items = Array.from({length:20},(_,i)=>({
    id:String(20*(page-1)+i+1), images:[],items:[],scenes:[],fileId:'',photoType:'FULL_BODY'
   }));
   return response({items,page,pageSize:20,total:40});
  });
  seed(env);env.load('pages/'+scenario.page+'/index');
  const page=env.page;page.setData=d=>Object.assign(page.data,d);page.onLoad({});page.account='A';
  const template=fs.readFileSync(path.join(source,'pages/'+scenario.page+'/index.wxml'),'utf8');
  const retryButton=template.match(/<t-button\b[^>]*>/g).find(button=>button.includes('bind:tap="'+scenario.more+'"'));
  assert.ok(retryButton.includes(scenario.error));
  for(const count of [0,20]){
   fail=true;
   await page[scenario.request](count===0);
   assert.ok(page.data[scenario.error]);
   assert.equal(page.data[scenario.rows].length,count);
   fail=false;
   await page[scenario.more]();
   assert.equal(page.data[scenario.error],'');
   assert.equal(page.data[scenario.rows].length,count+20);
  }
  assert.deepEqual(pages,[1,1,2,2]);
 });
 test(scenario.name+' picker displays new pages despite one bad image and retries only the missing cover',async()=>{
  const access=[];const pages=[];let bad=true;
  const env=environment(options=>{
   const url=new URL(options.url);
   if(url.pathname.endsWith('/'+scenario.path)){
    const p=Number(url.searchParams.get('page'));pages.push(p);
    const items=Array.from({length:20},(_,i)=>{
     const id=String(20*(p-1)+i+1),fileId='file-'+id;
     if(scenario.path==='dresses')return {id,name:id,images:[{fileId}]};
     if(scenario.path==='photos')return {id,fileId,photoType:'FULL_BODY'};
     return savedOutfit(id);
    });return response({items,page:p,pageSize:20,total:60});
   }
   const id=url.pathname.split('/').at(-2);access.push(id);
   if(id==='file-21'&&bad)return {statusCode:503,data:{message:'图片不可用'}};
   return response({url:'https://image.test/'+id});
  });
  let downloaded=0;
  seed(env);env.wx.downloadFile=o=>o.success({statusCode:200,tempFilePath:'/tmp/cover-'+ ++downloaded});
  env.load('pages/'+scenario.page+'/index');
  const page=env.page;page.setData=d=>Object.assign(page.data,d);page.onLoad({});page.account='A';
  await page[scenario.request](true);await page[scenario.request]();await page[scenario.request]();
  assert.deepEqual(pages,[1,2,3]);assert.equal(page.data[scenario.rows].length,60);
  assert.equal(access.length,60);assert.equal(page.data[scenario.rows][20].cover,'');
  assert.ok(page.data[scenario.rows][21].cover);
  bad=false;await Promise.all([page[scenario.retry](),page[scenario.retry]()]);
  assert.deepEqual(pages,[1,2,3]);assert.equal(access.length,61);assert.equal(access.at(-1),'file-21');
  assert.ok(page.data[scenario.rows][20].cover);
  const event={currentTarget:{dataset:{id:'file-1',cover:page.data[scenario.rows][0].cover}}};
  page[scenario.renderError](event);
  assert.equal(page.data[scenario.rows][0].cover,'');
  await page[scenario.retry]();
  const repaired=page.data[scenario.rows][0].cover;
  assert.ok(repaired);assert.notEqual(repaired,event.currentTarget.dataset.cover);
  assert.equal(access.length,62);assert.equal(access.at(-1),'file-1');
  page[scenario.renderError](event);
  assert.equal(page.data[scenario.rows][0].cover,repaired);
  assert.deepEqual(pages,[1,2,3]);
 });
}
