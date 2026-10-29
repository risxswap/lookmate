import type { DesignInput } from './api';

export type HairPath = 'GALLERY' | 'FREE';
export type HairDraft = Pick<DesignInput, 'requirements' | 'occasion' | 'style' | 'hairstyleId' | 'hairstyleVersion' | 'useReferenceHairColor'>;

export function hairDraft(input: DesignInput): HairDraft {
  return { requirements: input.requirements, occasion: input.occasion, style: input.style, hairstyleId: input.hairstyleId ?? null, hairstyleVersion: input.hairstyleVersion ?? null, useReferenceHairColor: input.useReferenceHairColor ?? false };
}

/** The inactive path is retained locally, never mixed into the submitted request. */
export function restoreHairDraft(path: HairPath, draft: HairDraft): Partial<DesignInput> {
  return { ...draft, ...(path === 'FREE' ? { hairstyleId: null, hairstyleVersion: null, useReferenceHairColor: false } : {}), constraintOverrides: [] };
}

export function chooseHairstyle(id: string, version: string): Partial<DesignInput> {
  return { hairstyleId: id, hairstyleVersion: version, useReferenceHairColor: false, constraintOverrides: [] };
}

export function restrictionChoices<T extends { id: string }>(restrictions: T[], conflicts: { restrictionId: string }[], overrides: string[]) {
  const visible = new Set([...conflicts.map(value => value.restrictionId), ...overrides]);
  return { direct: restrictions.filter(value => visible.has(value.id)), optional: restrictions.filter(value => !visible.has(value.id)) };
}
