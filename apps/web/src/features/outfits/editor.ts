import type { Outfit } from './api';

export type OutfitDraft = Pick<Outfit, 'name' | 'pinned' | 'groups' | 'items'> & { note: string };

export function outfitBody(draft: OutfitDraft, initial?: Outfit) {
  const name = draft.name.trim();
  const note = draft.note || null;
  const dressIds = draft.items.map(item => item.dressId);
  const groupIds = draft.groups.map(group => group.id);
  if (!initial) return { name, note, pinned: draft.pinned, dressIds, groupIds };

  const sameItems = initial.items.length === dressIds.length && initial.items.every((item, i) => item.dressId === dressIds[i]);
  const groups = new Set(groupIds);
  const sameGroups = initial.groups.length === groups.size && initial.groups.every(group => groups.has(group.id));
  return {
    version: initial.version,
    ...(name !== initial.name && { name }),
    ...(note !== initial.note && { note }),
    ...(draft.pinned !== initial.pinned && { pinned: draft.pinned }),
    ...(!sameItems && { dressIds }),
    ...(!sameGroups && { groupIds }),
  };
}

export function mergeOutfitDraft(draft: OutfitDraft, previous: Outfit, latest: Outfit): OutfitDraft {
  const changes = outfitBody(draft, previous);
  return {
    name: 'name' in changes ? draft.name : latest.name,
    note: 'note' in changes ? draft.note : latest.note ?? '',
    pinned: 'pinned' in changes ? draft.pinned : latest.pinned,
    items: 'dressIds' in changes ? draft.items : latest.items,
    groups: 'groupIds' in changes ? draft.groups : latest.groups,
  };
}
