import type { DesignInput, PendingSubmission } from '../generation/api';

export type OutfitPath = 'gallery' | 'free';
type SavedDraft = { input: DesignInput; sourceId?: string };
let owner: string | undefined;
let drafts: Partial<Record<OutfitPath, SavedDraft>> = {};
let personFileId: string | undefined;
let galleryView: { href: string; scroll: number } | undefined;

/** Ordinary drafts exist only in this document, never in persistent browser storage. */
export function activateOutfitAccount(accountId: string) {
  if (owner !== accountId) { drafts = {}; personFileId = undefined; galleryView = undefined; owner = accountId; }
}
export function clearOutfitDrafts() { owner = undefined; drafts = {}; personFileId = undefined; galleryView = undefined; }
export function readOutfitDraft(accountId: string, path: OutfitPath): SavedDraft | undefined {
  activateOutfitAccount(accountId);
  const saved = drafts[path];
  return saved ? { ...saved, input: { ...structuredClone(saved.input), personFileId: personFileId ?? saved.input.personFileId, constraintOverrides: [] } } : undefined;
}
export function saveOutfitDraft(accountId: string, path: OutfitPath, input: DesignInput, sourceId?: string) {
  if (owner !== accountId || input.designType !== 'OUTFIT') return;
  personFileId = input.personFileId;
  drafts[path] = { input: structuredClone(input), sourceId };
}
export function clearOutfitDraft(accountId: string, path: OutfitPath) {
  if (owner === accountId) delete drafts[path];
}
export function initialOutfitInput(accountId: string, path: OutfitPath, fallback: DesignInput, target?: { id: string; version: string }, sourceId?: string): DesignInput {
  const saved = readOutfitDraft(accountId, path);
  const base = sourceId && saved?.sourceId !== sourceId ? fallback : saved?.input ?? fallback;
  const input = { ...structuredClone(base), designType: 'OUTFIT' as const, personFileId: sourceId ? base.personFileId : personFileId ?? base.personFileId, hairstyleId: null, hairstyleVersion: null, useReferenceHairColor: false, constraintOverrides: [] };
  if (path === 'free') return { ...input, outfitInspirationId: null, outfitInspirationVersion: null, useReferenceHairColor: false };
  if (target && (input.outfitInspirationId !== target.id || input.outfitInspirationVersion !== target.version)) return { ...input, outfitInspirationId: target.id, outfitInspirationVersion: target.version, useReferenceHairColor: false };
  return input;
}

/** Pending submissions keep their original mode regardless of the entry URL. */
export function outfitEditorPath(requested: string | null, sourceHasTarget: boolean | undefined, pendingInput?: DesignInput): OutfitPath {
  if (pendingInput?.designType === 'OUTFIT') return pendingInput.outfitInspirationId ? 'gallery' : 'free';
  return requested === 'free' || requested === null && sourceHasTarget === false ? 'free' : 'gallery';
}

export function rememberOutfitGallery(accountId: string, href: string, scroll: number) {
  if (owner !== accountId || !/^\/app\/outfit-design(?:\?[^#]*)?$/.test(href)) return;
  galleryView = { href, scroll: Math.max(0, scroll) };
}
export function outfitGalleryReturn(accountId: string) {
  return owner === accountId ? galleryView ?? { href: '/app/outfit-design', scroll: 0 } : { href: '/app/outfit-design', scroll: 0 };
}

/** Recovery of an old request must not erase later edits or an unrelated retry draft. */
export function completeOutfitSubmission(accountId: string, submission?: PendingSubmission) {
  if (owner !== accountId || submission?.accountId !== accountId || submission.kind !== 'CREATE' || submission.input.designType !== 'OUTFIT') return;
  const path = submission.input.outfitInspirationId ? 'gallery' : 'free';
  if (JSON.stringify(drafts[path]?.input) === JSON.stringify(submission.input)) delete drafts[path];
}
