import type { Account } from '../../api/client';

export type QrStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'CONSUMED';
export interface QrTicket { id: string; expiresAt: string; imageDataUrl: string }
export interface QrProgress { id: string; expiresAt: string; status: QrStatus }
export interface QrView { ticket?: QrTicket; status: QrStatus | 'LOADING' | 'CLAIMING' | 'ERROR'; error?: string; canRetryStatus?: boolean }
export interface QrApi {
  create(signal: AbortSignal): Promise<QrTicket>;
  status(id: string, signal: AbortSignal): Promise<QrProgress>;
  claim(id: string, signal: AbortSignal): Promise<Account>;
  account(signal: AbortSignal): Promise<Account>;
}

/** Single owned lifecycle: never overlap claims or accept a response from an old login code. */
export function createQrLogin(api: QrApi, changed: (view: QrView) => void, loggedIn: (account: Account) => void, now = Date.now) {
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticket: QrTicket | undefined;
  let stopped = false;
  let busy = false;
  let phase: QrView['status'] = 'LOADING';
  let claimStarted = false;
  const publish = (status: QrView['status'], error?: string) => {
    phase = status;
    if (!stopped) changed({ ticket, status, error, canRetryStatus: !!ticket && !claimStarted });
  };
  const cancelPending = () => { controller?.abort(); if (timer) clearTimeout(timer); timer = undefined; };
  const current = (signal: AbortSignal) => !stopped && !signal.aborted;
  const expired = () => !ticket || Date.parse(ticket.expiresAt) <= now();
  function schedule(signal: AbortSignal) {
    if (!current(signal)) return;
    timer = setTimeout(() => void poll(signal), Math.min(2000, Math.max(0, Date.parse(ticket!.expiresAt) - now())));
  }
  async function claim(signal: AbortSignal) {
    if (!ticket || !current(signal)) return;
    busy = true; claimStarted = true;
    publish('CLAIMING');
    try {
      let account: Account;
      try { account = await api.claim(ticket.id, signal); }
      catch (failure) {
        if (!current(signal)) return;
        if (failure && typeof failure === 'object' && 'status' in failure && typeof failure.status === 'number' && failure.status < 500) throw failure;
        // A lost claim response can still have set the new cookie. Reconcile read-only, never re-claim.
        try { account = await api.account(signal); }
        catch { throw failure; }
      }
      if (current(signal)) { publish('CONSUMED'); loggedIn(account); }
    } catch (failure) {
      if (current(signal)) publish('ERROR', failure instanceof Error ? failure.message : '登录结果尚未确认，请重新获取登录码');
    } finally { if (current(signal)) busy = false; }
  }
  async function poll(signal: AbortSignal) {
    if (!current(signal) || !ticket) return;
    if (expired()) { publish('EXPIRED'); return; }
    try {
      const result = await api.status(ticket.id, signal);
      if (!current(signal)) return;
      if (result.id !== ticket.id) throw new Error('登录请求不匹配，请刷新登录码');
      if (expired()) { publish('EXPIRED'); return; }
      if (result.status === 'CONFIRMED') { await claim(signal); return; }
      publish(result.status);
      if (result.status === 'PENDING') schedule(signal);
    } catch (failure) {
      if (current(signal)) publish(expired() ? 'EXPIRED' : 'ERROR', failure instanceof Error ? failure.message : '无法读取登录状态');
    }
  }
  return {
    async refresh() {
      if (stopped || busy) return;
      cancelPending();
      controller = new AbortController();
      const signal = controller.signal;
      busy = true; claimStarted = false; ticket = undefined; publish('LOADING');
      try {
        const next = await api.create(signal);
        if (!current(signal)) return;
        if (!Number.isFinite(Date.parse(next.expiresAt)) || !/^data:image\/(png|jpeg);base64,/.test(next.imageDataUrl)) throw new Error('登录码暂时不可用，请重试');
        ticket = next;
        if (expired()) publish('EXPIRED');
        else { publish('PENDING'); schedule(signal); }
      } catch (failure) {
        if (current(signal)) publish('ERROR', failure instanceof Error ? failure.message : '登录码读取失败');
      } finally { if (current(signal)) busy = false; }
    },
    retryStatus() {
      if (stopped || busy || !ticket || claimStarted || phase !== 'ERROR') return;
      cancelPending(); controller = new AbortController(); publish('PENDING'); void poll(controller.signal);
    },
    stop() { stopped = true; cancelPending(); },
  };
}
