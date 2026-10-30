import { ApiError, installRecovery, request } from './request';
import { Account, clearSession, saveSession, session, updateAccount, validSession } from './session';
export type { Account } from './session';
type Authenticated = {status:'AUTHENTICATED'; token:string; expiresAt:string; account:Account};
type Unbound = {status:'UNBOUND'; ticket:string; expiresAt:string};
type LoginResult = Authenticated | Unbound;
let recovery: Promise<Account> | undefined;
let blocked = false;
let unbound: Unbound | undefined;
export function getAccount(): Account | null { return session()?.account || null; }
export function bindingTicket(): Unbound | undefined { return unbound; }
export function loginCode(): Promise<string> { return new Promise((resolve,reject) => wx.login({timeout:15000,success:r => r.code ? resolve(r.code) : reject(new Error('微信登录未返回有效凭据')),fail:() => reject(new Error('微信身份验证失败，请重试'))})); }
export async function login(): Promise<LoginResult> {
  const result = await request<LoginResult>('/auth/wechat/login',{method:'POST',body:{code:await loginCode()},auth:false});
  if (result.status === 'AUTHENTICATED') { saveSession(result); unbound=undefined; blocked=false; }
  else { clearSession(); unbound=result; }
  return result;
}
async function recoverLogin(): Promise<Account> {
  if (recovery) return recovery;
  if (blocked) throw new ApiError(401,{code:'LOGIN_REQUIRED',message:'请点击重新登录以恢复身份'});
  recovery=(async () => {
    clearSession();
    try { const result=await login(); if(result.status==='UNBOUND') throw new ApiError(401,{code:'WECHAT_UNBOUND',message:'请选择创建账号或绑定已有账号'}); return result.account; }
    catch(error) { blocked=true; throw error; }
    finally { recovery=undefined; }
  })();
  return recovery;
}
installRecovery(recoverLogin);
export async function ensureSession(): Promise<Account> {
  if (!session()) throw new ApiError(401,{code:'LOGIN_REQUIRED',message:'请先登录'});
  if (!validSession()) {
    const previous=session()?.account.id; const account=await recoverLogin();
    if(previous && previous!==account.id) {wx.reLaunch({url:'/pages/home/index'}); throw new ApiError(401,{code:'ACCOUNT_CHANGED',message:'微信账号已变化，请重新进入页面'});}
    return account;
  }
  const account=await request<Account>('/auth/me'); updateAccount(account); return account;
}
export async function manualLogin(): Promise<LoginResult> { blocked=false; return login(); }
export async function register(): Promise<Account> { return complete('/auth/wechat/register',{}); }
export async function bind(username:string,password:string): Promise<Account> { return complete('/auth/wechat/bind',{username,password}); }
async function complete(path:string,extra:Record<string,string>):Promise<Account> {
  if (!unbound || Date.parse(unbound.expiresAt)<=Date.now()) { unbound=undefined; throw new Error('微信登录凭据已过期，请重新登录'); }
  const result=await request<Authenticated>(path,{method:'POST',body:{ticket:unbound.ticket,...extra},auth:false});
  saveSession(result); unbound=undefined; blocked=false; return result.account;
}
let redirecting=false;
export async function requireAccount():Promise<Account|null> {
  try { return await ensureSession(); }
  catch(error) {
    if(error instanceof ApiError && error.detail.code==='ACCOUNT_CHANGED') return null;
    if(!(error instanceof ApiError) || error.status!==401) throw error;
    if(!redirecting && getCurrentPages()[getCurrentPages().length-1]?.route !== 'pages/login/index') { redirecting=true; wx.navigateTo({url:'/pages/login/index',complete:()=>{redirecting=false;}}); }
    return null;
  }
}
