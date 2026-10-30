export function errorMessage(error:unknown):string { return error instanceof Error ? error.message : '操作未完成，请重试'; }
export function showError(error:unknown):void { wx.showModal({title:'操作未完成',content:errorMessage(error),showCancel:false}); }
export function confirm(content:string,title='请确认'):Promise<boolean> { return new Promise(resolve=>wx.showModal({title,content,success:r=>resolve(r.confirm),fail:()=>resolve(false)})); }
export function toast(title:string):void { wx.showToast({title,icon:'none'}); }
export function inputValue(event:WechatMiniprogram.CustomEvent):string { return String(event.detail.value ?? ''); }
export function query(values:Record<string,unknown>):string { return Object.entries(values).filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&'); }
export function navigate(url:string):void { wx.navigateTo({url}); }
