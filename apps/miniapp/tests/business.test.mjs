import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const source=path.resolve('src');
function environment(handler=()=>({data:null,statusCode:200})){
 const stored=new Map(),calls=[],navigation=[];let logins=0;let pageDefinition;const modules=new Map();
 const wx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,v),removeStorageSync:k=>stored.delete(k),reLaunch:r=>navigation.push(r.url),navigateTo:r=>navigation.push(r.url),login:o=>{logins++;queueMicrotask(()=>o.success({code:'wechat-code'}));},request:o=>{calls.push(o);Promise.resolve().then(()=>handler(o)).then(r=>o.success(r),()=>o.fail({}));}};
 function load(name){const file=path.resolve(source,name.endsWith('.ts')?name:name+'.ts');if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{wx,Page:value=>{pageDefinition=value;},getCurrentPages:()=>[{route:"pages/home/index"}],console,Error,Date,setTimeout,clearTimeout,setInterval,clearInterval,Uint8Array})(spec=>load(path.relative(source,path.resolve(path.dirname(file),spec))),module,module.exports);return module.exports;}
 return {load,wx,stored,calls,navigation,get page(){return pageDefinition;},get logins(){return logins;}};
}
const account=id=>({id,username:null,displayName:null,hasPassword:false,wechatBound:true,avatarFileId:null});
const authenticated=(id='A')=>({status:'AUTHENTICATED',token:'new',expiresAt:'2099-01-01T00:00:00Z',account:account(id)});
const expired={statusCode:401,data:{code:'UNAUTHENTICATED',message:'expired'}};
const response=data=>({statusCode:200,data:{data,requestId:'test'}});
function seed(env){env.load('lib/session').saveSession({token:'old',expiresAt:'2099-01-01T00:00:00Z',account:account('A')});}

test('design submission success clears only submitted mode draft and pending key',async()=>{
 const env=environment(()=>response({taskId:'task-1',status:'QUEUED'}));seed(env);
 const store=env.load('lib/storage');store.saveDraft('HAIRSTYLE',{requirements:'hair'});store.saveDraft('OUTFIT',{requirements:'outfit'});
 const design=env.load('features/design');const pending={kind:'CREATE',accountId:'A',key:'same-key',input:{designType:'HAIRSTYLE'},previewToken:'preview'};
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
