import { API_BASE, REQUEST_TIMEOUT } from '../config';
import { session } from './session';
export interface ErrorBody { code: string; message: string; requestId?: string; fieldErrors?: {field:string; message:string}[] }
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly detail: ErrorBody) { super(detail.message); }
}
export interface RequestOptions { method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown; auth?: boolean; headers?: Record<string,string> }
let recover: (() => Promise<unknown>) | undefined;
export function installRecovery(handler: () => Promise<unknown>): void { recover = handler; }
export function tokenHeaders(): Record<string,string> { const token = session()?.token; return token ? {'X-Miniapp-Token':token} : {}; }
export function assertAccount(expected:string|undefined):void {
  if(expected && session()?.account.id!==expected) throw new ApiError(401,{code:'ACCOUNT_CHANGED',message:'账号已变化，请重新进入页面后操作'});
}
export function apiUrl(path: string): string { return API_BASE + path; }
function send<T>(path: string, options: RequestOptions): Promise<T> {
  return new Promise((resolve,reject) => wx.request({
    url: apiUrl(path), method: options.method === 'PATCH' ? 'POST' : options.method || 'GET', timeout: REQUEST_TIMEOUT,
    header: {'Content-Type':'application/json', ...(options.auth === false ? {} : tokenHeaders()), ...options.headers, ...(options.method === 'PATCH' ? {'X-HTTP-Method-Override':'PATCH'} : {})},
    ...(options.body === undefined ? {} : {data:options.body as Record<string,unknown>}),
    success(response) {
      const payload = response.data as {data?:T} & Partial<ErrorBody>;
      if (response.statusCode >= 200 && response.statusCode < 300 && payload && typeof payload === 'object' && 'data' in payload) resolve(payload.data as T);
      else reject(new ApiError(response.statusCode, {code:payload?.code || 'INVALID_RESPONSE',message:payload?.message || '服务响应异常，请稍后重试',requestId:payload?.requestId,fieldErrors:payload?.fieldErrors}));
    }, fail() { reject(new Error('网络连接失败，请检查网络后重试')); },
  }));
}
/** Only safe reads may be replayed after reauthentication. Writes remain explicit user actions. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const originalToken = session()?.token;
  const originalAccount = session()?.account.id;
  try { const result=await send<T>(path,options); if(options.auth!==false) assertAccount(originalAccount); return result; }
  catch (error) {
    if (error instanceof ApiError && error.detail.code==='ACCOUNT_CHANGED') throw error;
    if (!(error instanceof ApiError) || error.status !== 401 || options.auth === false || !recover) throw error;
    if (!session()?.token || session()?.token === originalToken) await recover();
    if (originalAccount && session()?.account.id !== originalAccount) {
      wx.reLaunch({url:'/pages/home/index'});
      throw new ApiError(401,{code:'ACCOUNT_CHANGED',message:'微信账号已变化，已返回首页；原账号草稿保持隔离'});
    }
    if ((options.method || 'GET') === 'GET') { const result=await send<T>(path,options); assertAccount(originalAccount); return result; }
    throw new ApiError(401,{code:'SESSION_RESTORED',message:'登录已恢复，本次操作未自动重试，请确认后重新操作'});
  }
}
