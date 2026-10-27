import { useEffect, useRef, useState } from 'react';
import { usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import type { Photo, PhotoAngle } from './queries';
import type { ProfileSession } from './useProfileSession';

interface Target { slot: 'PORTRAIT' | 'FULL_BODY' | 'SUPPLEMENT'; photo?: Photo; angle?: PhotoAngle }
interface Slots { portrait: Photo | null; fullBody: Photo | null; supplements: Photo[]; angles?: Partial<Record<PhotoAngle, Photo | null>> }

/** Own one selected upload: automatic first write, explicit rejection retry, read-only reconciliation. */
export function usePhotoSlotUpload(target: Target | null, items: ImageDraft[], session: ProfileSession, blocked: boolean, slots?: Slots) {
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submitted = useRef(false);
  useEffect(() => { if (attempted && (session.unknown || session.confirmed)) setUncertain(true); }, [attempted, session.unknown, session.confirmed]);
  function persist() {
    const item = items[0];
    if (!target || !item || !usableImage(item) || blocked || saved || uncertain) return;
    submitted.current = true;
    setAttempted(true);
    session.save({ path: '/photos/slots', method: 'POST', scope: 'photos', body: { fileId: item.fileId, slot: target.slot, ...(target.angle ? { angle: target.angle } : {}), ...(target.slot === 'SUPPLEMENT' && target.photo ? { replacePhotoId: target.photo.id } : {}) } }, () => { setSaved(true); setUncertain(false); });
  }
  useEffect(() => {
    if (target && items[0] && usableImage(items[0]) && !submitted.current && !blocked) persist();
  }, [items, target, blocked]);
  useEffect(() => {
    if (!uncertain || !slots || !items[0]?.fileId) return;
    const candidates = target?.angle ? [slots.angles?.[target.angle]] : target?.slot === 'PORTRAIT' ? [slots.portrait] : target?.slot === 'FULL_BODY' ? [slots.fullBody] : slots.supplements;
    if (candidates.some(photo => photo?.fileId === items[0].fileId)) { setSaved(true); setUncertain(false); }
  }, [slots, uncertain, items, target]);
  return { attempted, saved, uncertain, persist, reset: () => { setAttempted(false); setSaved(false); setUncertain(false); submitted.current = false; } };
}
