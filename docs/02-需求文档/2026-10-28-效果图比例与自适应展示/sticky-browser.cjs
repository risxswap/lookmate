const { chromium } = require('/Users/haiming/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>(errors.push(e.message),console.log(e.message)));
 let task={id:'1',title:'通勤形象设计',designType:'OVERALL',status:'SUCCEEDED',actions:['VIEW'],createdAt:'2026-10-28T01:00:00Z',updatedAt:'2026-10-28T01:00:00Z',result:null,outputFileId:'output',inputSummary:{request:{requirements:'保留外套，适合通勤，简洁且容易打理',occasion:'通勤',style:'简约'},personPhoto:{fileId:'photo'},requiredDresses:[{dressId:'coat',dressName:'米色外套',imageFileIds:['coat']}],constraintOverrides:[]}};
 const result={title:'清爽通勤方案',summary:'用浅色外套搭配自然短发，保持利落轮廓。',style:'简约',occasion:'通勤',designReason:'颜色呼应，轮廓清晰。',colorAdvice:'米色搭配白色',items:[{dressId:'coat',dressName:'米色外套',imageFileIds:['coat'],categoryName:'外套',wearingMethod:'敞开穿着',matchReason:'呼应整体风格'}],hairstyle:{hairstyleName:'自然短发',lengthAdvice:'耳上',bangsAdvice:'侧分',partingAdvice:'自然',textureAdvice:'蓬松',hairColorAdvice:'自然黑',careAdvice:'吹干定型'}};
 let dimensions=[768,1024]; task.result=result;
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;if(!p.startsWith('/api/'))return route.continue();let data=null;if(p==='/api/auth/me')data={id:'1',username:'fixture',displayName:'模拟账号'};else if(p==='/api/auth/csrf')data={token:'fixture',headerName:'X-CSRF-TOKEN'};else if(p==='/api/designs/1')data=task;else if(p.includes('/access')) { const [w,h]=p.includes('/photo/') ? [600,1000] : dimensions; data={url:'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#deded2"/><rect x="2" y="2" width="${w-4}" height="${h-4}" fill="none" stroke="#315c50" stroke-width="4"/><text x="20" y="50" font-size="28">${w} × ${h}</text></svg>`),expiresAt:'2027-01-01T00:00:00Z'};};await route.fulfill({contentType:'application/json',body:JSON.stringify({data,requestId:"fixture"})});});


 const results=[];
 result.items=Array.from({length:20},(_,i)=>({...result.items[0],dressId:'coat'+i,dressName:'单品'+i}));
 try {
 await page.goto('http://127.0.0.1:5187/app/designs/1');
 await page.getByRole('img',{name:'本次设计效果图',exact:true}).waitFor();
 await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0));
 const visual=page.locator('.studio-detail-visual');
 for(const y of [400,800]) {
  await page.evaluate(y=>window.scrollTo(0,y),y);await page.waitForTimeout(150);
  const box=await visual.boundingBox();assert.ok(Math.abs(box.y-16)<2,JSON.stringify(box));results.push({scroll:y,top:box.y});
 }
 await page.screenshot({path:__dirname+'/sticky-desktop.png'});
 task.result.notices=Array.from({length:20},(_,i)=>({code:'N'+i,severity:'WARNING',placement:'NEAR_IMAGE',message:'提示'+i+'：请根据实际情况判断。'}));
 await page.reload();await visual.waitFor();await page.waitForTimeout(300);
 const tall=await visual.evaluate(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
 assert.ok(tall.height<=968);assert.ok(tall.scrollHeight>tall.clientHeight);
 await visual.evaluate(el=>el.scrollTop=el.scrollHeight);
 assert.ok(await visual.getByText('提示19：请根据实际情况判断。').isVisible());results.push({longNoticesAccessible:true});
 await page.setViewportSize({width:900,height:900});await page.evaluate(()=>window.scrollTo(0,0));
 assert.equal(await visual.evaluate(el=>getComputedStyle(el).position),'static');
 await page.evaluate(()=>window.scrollTo(0,400));await page.waitForTimeout(100);assert.ok((await visual.boundingBox()).y<0);results.push({narrowStatic:true});
 task.outputFileId=null;await page.setViewportSize({width:1440,height:1000});await page.reload();await visual.waitFor();assert.equal(await visual.evaluate(el=>getComputedStyle(el).position),'static');results.push({noOutputStatic:true});
 assert.deepEqual(errors,[]);fs.writeFileSync(__dirname+'/sticky-results.json',JSON.stringify({browser:browser.version(),results,errors,mockedApi:true},null,2));
 } finally {await browser.close();}
})();
