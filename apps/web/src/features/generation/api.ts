import { request } from '../../api/client';
import type { Preferences } from '../profile/preferences';
import type { MeasurementValues } from '../profile/queries';

export type DesignType = 'OVERALL' | 'HAIRSTYLE' | 'OUTFIT';
export interface DesignInput {
  designType: DesignType; personFileId: string; profileVersion: string;
  requirements: string; occasion: string; style: string; weatherNote: string;
  requiredDressIds: string[]; useMeasurements: boolean; measurementId: string | null;
  constraintOverrides: string[];
}
export interface PersonalContext {
  profileVersion: string; gender: string | null; age: number | null; ageAsOf: string;
  preferences: Preferences | null; measurementState: string; measurementId: string | null;
  measurements: Partial<MeasurementValues> | null; measurementUnits?: { length: string; weight: string };
}
export interface RequiredDress { dressId: string; dressName: string; categoryName: string; imageFileIds: string[] }
export interface DesignNotice { code: string; severity: string; message: string; placement?: string }
export interface Preview {
  canSubmit: boolean; previewToken: string | null; expiresAt: string | null; inputDigest: string;
  personPhoto: { fileId: string }; requiredDresses: RequiredDress[]; personalContext: PersonalContext;
  restrictions: { id: string; text: string; overridden: boolean }[];
  conflicts: { restrictionId: string; requirementExcerpt: string; message: string }[];
  notices: DesignNotice[]; limits: { maxRequiredDressCount: number }; semanticCheck: string;
}
export interface InputSummary {
  schemaVersion: number; request: Partial<DesignInput>; personPhoto: { fileId: string };
  personalContext: PersonalContext; requiredDresses: RequiredDress[];
  constraintOverrides: { id: string; originalText: string }[];
}
export interface Submission { taskId: string; status: string; statusUrl: string; retryOfTaskId?: string }
export type PendingSubmission = { accountId: string; key: string } & (
  { kind: 'CREATE'; input: DesignInput; previewToken: string } |
  { kind: 'RETRY'; sourceId: string; mode: 'FULL' | 'IMAGE_ONLY' }
);
const storagePrefix = 'lookmate:generation:';
export function readPending(accountId: string): PendingSubmission | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storagePrefix + accountId) || 'null') as PendingSubmission | null;
    return value?.accountId === accountId && typeof value.key === 'string' && ['CREATE', 'RETRY'].includes(value.kind) ? value : null;
  } catch { return null; }
}
export function savePending(value: PendingSubmission) { sessionStorage.setItem(storagePrefix + value.accountId, JSON.stringify(value)); }
export function clearPending(accountId: string) { sessionStorage.removeItem(storagePrefix + accountId); }
export function clearGenerationRecovery() {
  Object.keys(sessionStorage).filter(key => key.startsWith(storagePrefix)).forEach(key => sessionStorage.removeItem(key));
}
export function findSubmission(key: string) { return request<Submission>(`/designs/by-request/${encodeURIComponent(key)}`); }
export function sendSubmission(pending: PendingSubmission) {
  const path = pending.kind === 'CREATE' ? '/designs' : `/designs/${pending.sourceId}/retry`;
  const body = pending.kind === 'CREATE' ? { input: pending.input, previewToken: pending.previewToken } : { mode: pending.mode };
  return request<Submission>(path, { method: 'POST', body, headers: { 'Idempotency-Key': pending.key } });
}
