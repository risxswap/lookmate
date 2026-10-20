export interface Account { id: string; username: string; displayName: string | null }
interface Envelope<T> { data: T; requestId: string }
interface ErrorBody { code: string; message: string; requestId: string; retryAfterSeconds?: number; fieldErrors?: { field: string; message: string }[] }
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly detail: ErrorBody) {
    super(detail.message);
  }
}
let csrf: { token: string; headerName: string } | undefined;
let csrfRequest: Promise<void> | undefined;
export async function refreshCsrf() {
  if (!csrfRequest) {
    csrf = undefined;
    csrfRequest = request<{ token: string; headerName: string }>('/auth/csrf')
      .then(value => { csrf = value; }).finally(() => { csrfRequest = undefined; });
  }
  return csrfRequest;
}
export async function request<T>(path: string, options: { body?: unknown; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  if (method !== 'GET' && !csrf) await refreshCsrf();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers[csrf.headerName] = csrf.token;
  const response = await fetch(`/api${path}`, {
    method, headers, credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let json: Envelope<T> | ErrorBody;
  try { json = await response.json(); }
  catch { throw new Error('服务响应异常，请稍后重试'); }
  if (!response.ok) {
    const error = json as ErrorBody;
    if (error.code === 'CSRF_INVALID') {
      csrf = undefined;
      await refreshCsrf();
    }
    if (error.code === 'UNAUTHENTICATED' && path !== '/auth/me') {
      window.dispatchEvent(new Event('lookmate:unauthenticated'));
    }
    throw new ApiError(response.status, error);
  }
  return (json as Envelope<T>).data;
}
export async function write<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}
