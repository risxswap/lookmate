import type { Profile } from '../types/api';

/** Navigation context sent over the native EventChannel. */
export interface HistoryOpener {
    visitId: number;
    accountId: string;
    dirty: boolean;
}

export type HistoryChange = { accountId: string } & (
    | { kind: 'pending'; pending: boolean }
    | { kind: 'current'; profile: Profile }
    | { kind: 'deleted'; previousVersion: string; version: string }
);

type Receive = (change: HistoryChange) => void;
let nextVisitId = 0;
const receivers = new Map<number, Receive>();

/** The history page takes this callback once, so an in-flight write can finish after native Back. */
export function registerHistoryReceiver(receive: Receive): number {
    const visitId = ++nextVisitId;
    receivers.set(visitId, receive);
    return visitId;
}

export function takeHistoryReceiver(visitId: number): Receive | undefined {
    const receive = receivers.get(visitId);
    releaseHistoryReceiver(visitId);
    return receive;
}

export function releaseHistoryReceiver(visitId: number): void {
    receivers.delete(visitId);
}
