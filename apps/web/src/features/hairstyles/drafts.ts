import type { DesignInput, PendingSubmission } from '../generation/api';

export type HairstylePath = 'gallery' | 'free';
type SavedDraft = { input: DesignInput; sourceId?: string };
let owner: string | undefined;
let drafts: Partial<Record<HairstylePath, SavedDraft>> = {};
let personFileId: string | undefined;
let galleryView: { href: string; scroll: number } | undefined;

/** Ordinary drafts exist only in this document, never in persistent browser storage. */
export function activateHairAccount(accountId: string) {
  if (owner !== accountId) { drafts = {}; personFileId = undefined; galleryView = undefined; owner = accountId; }
}
export function clearHairDrafts() { owner = undefined; drafts = {}; personFileId = undefined; galleryView = undefined; }
export function readHairDraft(accountId: string, path: HairstylePath): SavedDraft | undefined {
  activateHairAccount(accountId);
  const saved = drafts[path];
  return saved ? { ...saved, input: { ...structuredClone(saved.input), personFileId: personFileId ?? saved.input.personFileId, constraintOverrides: [] } } : undefined;
}
export function saveHairDraft(accountId: string, path: HairstylePath, input: DesignInput, sourceId?: string) {
  if (owner !== accountId || input.designType !== 'HAIRSTYLE') return;
  personFileId = input.personFileId;
  drafts[path] = { input: structuredClone(input), sourceId };
}
export function clearHairDraft(accountId: string, path: HairstylePath) {
  if (owner === accountId) delete drafts[path];
}
export function initialHairInput(accountId: string, path: HairstylePath, fallback: DesignInput, target?: { id: string; version: string }, sourceId?: string): DesignInput {
  const saved = readHairDraft(accountId, path);
  const base = sourceId && saved?.sourceId !== sourceId ? fallback : saved?.input ?? fallback;
  const input = { ...structuredClone(base), designType: 'HAIRSTYLE' as const, personFileId: sourceId ? base.personFileId : personFileId ?? base.personFileId, useMeasurements: false, measurementId: null, weatherNote: '', requiredDressIds: [], constraintOverrides: [] };
  if (path === 'free') return { ...input, hairstyleId: null, hairstyleVersion: null, useReferenceHairColor: false };
  if (target && (input.hairstyleId !== target.id || input.hairstyleVersion !== target.version)) return { ...input, hairstyleId: target.id, hairstyleVersion: target.version, useReferenceHairColor: false };
  return input;
}

/** Pending submissions keep their original mode regardless of the entry URL. */
export function hairEditorPath(requested: string | null, sourceHasTarget: boolean | undefined, pendingInput?: DesignInput): HairstylePath {
  if (pendingInput?.designType === 'HAIRSTYLE') return pendingInput.hairstyleId ? 'gallery' : 'free';
  return requested === 'free' || requested === null && sourceHasTarget === false ? 'free' : 'gallery';
}

export function rememberHairGallery(accountId: string, href: string, scroll: number) {
  if (owner !== accountId || !/^\/app\/hairstyles(?:\?[^#]*)?$/.test(href)) return;
  galleryView = { href, scroll: Math.max(0, scroll) };
}
export function hairGalleryReturn(accountId: string) {
  return owner === accountId ? galleryView ?? { href: '/app/hairstyles', scroll: 0 } : { href: '/app/hairstyles', scroll: 0 };
}

/** Recovery of an old request must not erase later edits or an unrelated retry draft. */
export function completeHairSubmission(accountId: string, submission?: PendingSubmission) {
  if (owner !== accountId || submission?.accountId !== accountId || submission.kind !== 'CREATE' || submission.input.designType !== 'HAIRSTYLE') return;
  const path = submission.input.hairstyleId ? 'gallery' : 'free';
  if (JSON.stringify(drafts[path]?.input) === JSON.stringify(submission.input)) delete drafts[path];
}
