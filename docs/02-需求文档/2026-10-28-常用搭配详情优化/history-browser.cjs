const {chromium}=require('/Users/ming/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];const requests=[];let fail=false;let empty=false;let retries=0;let retryFail=false;
 const outfit={id:'1',name:'自在通勤',note:'衬衫前摆收进裤腰，外套敞开穿。',revision:'2',version:'1',pinned:false,groups:[],sourceOutputFileId:'source',items:[{dressId:'1',dressName:'米色外套',imageFileIds:['coat'],missing:false}]};
 const result={summary:'米色外套搭配浅色内搭，整体柔和利落，适合日常通勤。建议露出腰线，让宽松组合更有层次。',designReason:'外套与内搭的色彩接近，通过面料和明度变化形成层次。',colorAdvice:'保留低饱和配色，小面积深色配饰作为点缀。',wearingAdvice:'将衬衫前摆收进裤腰，外套敞开，袖口略微挽起。',items:[{dressId:'1',dressName:'米色外套',wearingMethod:'敞开穿着，保留纵向线条。'}],notices:[{code:'TEST',severity:'INFO',message:'此处为浏览器模拟数据。'}]};
 const base={outfitId:'1',revision:'2',kind:'IMAGE',status:'SUCCEEDED',createdAt:'2026-10-28T03:20:00Z',stale:false,errorMessage:null,actions:[],result};
 let jobs=[{...base,taskId:'10',outputFileId:'current'},{...base,taskId:'9',kind:'EVALUATION',outputFileId:null},{...base,taskId:'8',revision:'1',stale:true,outputFileId:'previous'},{...base,taskId:'7',status:'GENERATING',outputFileId:null,result:null,actions:['RETRY_FULL']},{...base,taskId:'6',status:'FAILED',errorMessage:'图片服务暂时不可用，请稍后重试。',outputFileId:null,result:null,actions:['RETRY_FULL','RETRY_IMAGE']}];
 const unknown={...base,taskId:'5',status:'UNKNOWN',result:null,outputFileId:null};
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());const p=u.pathname;let data=null;if(!p.startsWith("/api/"))return route.continue();
 if(p.endsWith('/ai-jobs')&&fail){return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'FIXTURE',message:'模拟网络失败'})});}
 if(p==='/api/auth/me')data={id:'1',username:'fixture',displayName:'模拟账号'};
 else if(p==='/api/auth/csrf')data={token:'fixture',headerName:'X-CSRF-TOKEN'};
 else if(p==='/api/outfits/1')data=outfit;
 else if(p.endsWith('/ai-jobs/current'))data={evaluation:jobs[0],image:jobs[0],latest:jobs[0]};
 else if(p.endsWith('/ai-jobs')){requests.push({page:u.searchParams.get('page'),pageSize:u.searchParams.get('pageSize')});data={items:empty?[]:u.searchParams.get('page')==='2'?[unknown]:jobs,total:empty?0:6,page:Number(u.searchParams.get('page')),pageSize:5};}
 else if(p.includes('/retry')){retries++;if(retryFail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'FIXTURE',message:'重试请求结果暂未确认'})});data=jobs[0];}
 else if(p.includes('/access'))data={url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="'+(p.includes('previous')?'#c6d3cf':'#e0d8c4')+'"/><path d="M105 85 L75 105 L50 205 L85 215 L105 155 L105 300 L195 300 L195 155 L215 215 L250 205 L225 105 L195 85 L175 110 L125 110 Z" fill="#85958a"/><text x="70" y="355" fill="#344e42" font-size="18">Fixture outfit</text></svg>'),expiresAt:'2027-01-01T00:00:00Z'};
 await route.fulfill({contentType:'application/json',body:JSON.stringify({data,requestId:'fixture'})});
 });
 const card=id=>page.locator(`article[aria-label$=" ${id}"]`);
 async function open(){await page.goto('http://127.0.0.1:5188/app/wardrobe/outfits/1');await page.getByRole('button',{name:'生成历史',exact:true}).click();await card('10').waitFor();await page.waitForTimeout(350);}
 async function noOverflow(){assert(await page.locator('.outfit-history .ant-drawer-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}
 try{
 await open();assert.equal(await page.locator('.outfit-history-card').count(),5);await card('10').getByText('当前展示',{exact:true}).waitFor();assert.equal(await page.getByText('当前展示',{exact:true}).count(),1);await card('10').getByRole('img',{name:'历史效果图缩略图'}).waitFor();checks.push('历史卡片含缩略图、摘要和唯一当前展示标记');
 await card('8').getByText('修改前的搭配',{exact:true}).waitFor();checks.push('旧版本卡片明确标记');
 assert.equal(await card('7').getByRole('button').count(),0);await card('7').getByText('正在处理，可离开页面，任务会继续执行。').waitFor();checks.push('活动任务无查看结果或重试按钮，即使fixture给出重试actions');
 await card('6').getByText('图片服务暂时不可用，请稍后重试。').waitFor();await card('6').getByRole('button',{name:'重新尝试',exact:true}).waitFor();await card('6').getByRole('button',{name:'重试效果图',exact:true}).waitFor();checks.push('失败原因和合法重试无需展开可见');
 await noOverflow();await page.screenshot({path:__dirname+'/history-desktop.png',fullPage:true});
 await card('10').getByRole('button',{name:'查看效果与建议'}).click();await card('10').getByRole('img',{name:'本次搭配效果图',exact:true}).waitFor();await card('10').getByRole('heading',{name:'穿法建议'}).waitFor();checks.push('展开完整效果图与分节建议');await page.screenshot({path:__dirname+'/history-expanded.png',fullPage:true});
 await card('9').getByRole('button',{name:'查看详细建议'}).click();assert.equal(await card('10').getByRole('img',{name:'本次搭配效果图',exact:true}).count(),0);await card('9').getByRole('heading',{name:'配色建议'}).waitFor();checks.push('文字评价可展开且仅展开一条记录');
 await page.locator('.outfit-history .ant-pagination-item-2').click();await card('5').waitFor();assert.equal(await page.locator('.outfit-history-card').count(),1);assert(requests.some(r=>r.page==='2'&&r.pageSize==='5'));await card('5').getByText('已停止自动刷新，请手动刷新查看结果，不会自动重新提交。').waitFor();checks.push('使用服务端分页，UNKNOWN保留刷新说明');
 await page.locator('.outfit-history .ant-pagination-item-1').click();await card('9').waitFor();assert.equal(await page.getByRole('button',{name:'收起详情',exact:true}).count(),0);checks.push('切页清理展开状态');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);const bounds=await page.locator('.outfit-history').boundingBox();assert(bounds.x>=-1 && bounds.width<=391);await noOverflow();await page.screenshot({path:__dirname+'/history-narrow.png',fullPage:false});checks.push('390px窄屏卡片及分页无横向溢出');
 await card('8').getByRole('button',{name:'查看效果与建议'}).click();await card('8').getByText('对应修改前的搭配',{exact:true}).waitFor();await noOverflow();checks.push('旧结果展开保留说明，窄屏完整图片无溢出');
 await card('6').getByRole('button',{name:'重试效果图',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.outfit-history .ant-btn-loading'));assert.equal(retries,1);checks.push('合法图片重试仍提交既有接口');
 retryFail=true;await card('6').getByRole('button',{name:'重试效果图',exact:true}).click();const drawer=page.locator('.outfit-history');await drawer.getByText('重试请求结果暂未确认',{exact:true}).waitFor();await drawer.getByText('提交结果待确认',{exact:true}).waitFor();await drawer.getByRole('button',{name:'找回任务',exact:true}).click();await drawer.getByText('提交结果待确认',{exact:true}).waitFor({state:'hidden'});checks.push('重试503反馈在抽屉内可见，找回任务后恢复');
 fail=true;await page.getByRole('button',{name:'刷新任务',exact:true}).click();await page.getByText('生成历史暂时无法加载',{exact:true}).waitFor({timeout:20000});fail=false;await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByText('生成历史暂时无法加载',{exact:true}).waitFor({state:'hidden'});checks.push('加载失败后可重试恢复');
 empty=true;await page.getByRole('button',{name:'刷新任务',exact:true}).click();await page.getByText('还没有生成记录',{exact:true}).waitFor();assert.equal(await page.locator('.outfit-history .ant-pagination').count(),0);checks.push('空历史显示引导且无分页');
 assert.deepEqual(errors,[]);fs.writeFileSync(__dirname+'/history-results.json',JSON.stringify({checks,errors,requests,mockedApi:true,browser:browser.version(),node:process.version},null,2));console.log(checks);
 }catch(e){console.error({errors});await page.screenshot({path:__dirname+'/history-failure.png',fullPage:true});throw e;}finally{await browser.close();}
})();
