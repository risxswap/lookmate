const {chromium}=require('/Users/ming/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let outfit={id:'1',name:'自在通勤',note:'衬衫前摆收进裤腰，外套敞开穿。',revision:'2',version:'1',pinned:false,groups:[{id:'1',name:'通勤'}],sourceOutputFileId:'old',items:[{dressId:'1',dressName:'米色外套',imageFileIds:['coat'],missing:false},{dressId:'2',dressName:'白色衬衫',imageFileIds:['shirt'],missing:false},{dressId:'3',dressName:'深色长裤',imageFileIds:['pants'],missing:false}]};
const result={summary:'浅色上装与深色长裤形成清晰层次。',designReason:'配色简洁。',colorAdvice:'保持低饱和色。',wearingAdvice:'外套敞开。',items:[],notices:[]};let job={taskId:'10',outfitId:'1',revision:'2',kind:'IMAGE',status:'SUCCEEDED',createdAt:'2026-10-28T01:00:00Z',stale:false,errorMessage:null,actions:[],outputFileId:'current',result};let current={evaluation:job,image:job,latest:job};let pages=[];let pinWrites=0;let failCurrent=false;let recovered=0;
await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let data=null;const p=url.pathname;if(!p.startsWith('/api/'))return route.continue();
if(p.endsWith('/ai-jobs/current') && failCurrent){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'FIXTURE',message:'模拟加载失败'})});return;}
if(p.includes('/by-request/')){recovered++;data=job;}else if(p==='/api/auth/me')data={id:'1',username:'fixture',displayName:'模拟账号'};else if(p==='/api/auth/csrf')data={token:'fixture',headerName:'X-CSRF-TOKEN'};else if(p==='/api/outfits/1'){if(route.request().method()==='PATCH'){pinWrites++;outfit={...outfit,pinned:!outfit.pinned};}data=outfit;}else if(p.endsWith('/ai-jobs/current'))data=current;else if(p.endsWith('/ai-jobs')){const n=Number(url.searchParams.get('page'));pages.push(n);data={items:n===1?[job]:[{...job,taskId:'old',revision:'0',stale:true}],total:6,page:n,pageSize:5};}else if(p.includes('/access'))data={url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#dfdfd2"/><text x="60" y="180" font-size="20">Fixture image</text></svg>'),expiresAt:'2027-01-01T00:00:00Z'};
await route.fulfill({contentType:'application/json',body:JSON.stringify({data,requestId:'fixture'})});});const checks=[];try{
const button = name => page.getByRole('button',{name,exact:true});
async function ready(){await page.goto('http://127.0.0.1:5188/app/wardrobe/outfits/1');await page.getByText('衬衫前摆收进裤腰，外套敞开穿。').waitFor();}
async function controlsVisible(){await button('评价这套搭配').waitFor();await button('生成效果图').waitFor();}
for(const status of ['QUEUED','PLANNING','GENERATING','SAVING']) {
 job={...job,kind:'EVALUATION',status,result:null,outputFileId:null};current={evaluation:null,image:null,latest:job};
 await ready();await page.getByText('正在处理，可离开页面，任务会继续执行。',{exact:true}).waitFor();
 for(const name of ['评价这套搭配','生成效果图','查看任务']) assert.equal(await button(name).count(),0);
 await button('生成历史').waitFor();checks.push(status+' 隐藏三个操作且保留状态和历史');
}
await page.screenshot({path:__dirname+'/processing-active.png',fullPage:true});
job={...job,status:'SUCCEEDED',result};current={evaluation:job,image:null,latest:job};await controlsVisible();await page.getByText(result.summary,{exact:true}).waitFor();checks.push('轮询成功后自动恢复评价和生成');
for(const status of ['FAILED','UNKNOWN']) {
 job={...job,status,result:null,errorMessage:status==='FAILED'?'模拟评价失败':null,actions:status==='FAILED'?['RETRY_FULL']:[]};current={evaluation:null,image:null,latest:job};await page.reload();await controlsVisible();await button('查看任务').click();await page.getByRole('dialog').waitFor();
 if(status==='FAILED')await button('重新尝试').waitFor();else await page.getByText('生成结果待确认，已停止自动刷新').waitFor();
 checks.push(status+' 保留查看任务和对应恢复提示');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
}
for(const change of [{revision:'1'},{stale:true}]) {
 job={...job,status:'GENERATING',errorMessage:null,revision:'2',stale:false,...change};current={evaluation:null,image:null,latest:job};await page.reload();await controlsVisible();assert.equal(await page.getByText('正在处理，可离开页面，任务会继续执行。',{exact:true}).count(),0);checks.push(JSON.stringify(change)+' 不隐藏当前搭配操作');
}
assert.deepEqual(errors,[]);fs.writeFileSync(__dirname+'/processing-results.json',JSON.stringify({checks,errors,mockedApi:true,browser:browser.version(),node:process.version},null,2));console.log(checks);
}finally{await browser.close();}})();
