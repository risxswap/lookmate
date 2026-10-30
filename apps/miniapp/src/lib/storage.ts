import { getAccount } from './auth';
const PREFIX='lookmate:mini:v1:';
function key(scope:string,accountId?:string):string {const id=accountId||getAccount()?.id;if(!id)throw new Error('请先登录');return `${PREFIX}${id}:${scope}`;}
export function readStored<T>(scope:string,accountId?:string):T|null {const raw=wx.getStorageSync(key(scope,accountId));return raw===undefined||raw===''?null:raw as T;}
export function writeStored<T>(scope:string,value:T|null,accountId?:string):void {const k=key(scope,accountId);if(value===null)wx.removeStorageSync(k);else wx.setStorageSync(k,value);}
export function readDraft<T>(mode:string):T|null{return readStored<T>(`draft:${mode}`);}
export function saveDraft<T>(mode:string,value:T|null):void{writeStored(`draft:${mode}`,value);}
export function requestKey():Promise<string> {return new Promise((resolve,reject)=>wx.getUserCryptoManager().getRandomValues({length:16,success:r=>resolve(Array.from(new Uint8Array(r.randomValues),b=>b.toString(16).padStart(2,'0')).join('')),fail:()=>reject(new Error('无法创建提交标识，请重试'))}));}
