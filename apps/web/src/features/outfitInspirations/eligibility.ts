import type { DesignInput } from '../generation/api';
import type { OutfitInspiration } from './queries';
import type { OutfitPath } from './drafts';
/** A failed/currently refreshing catalog read never turns a target design into free mode. */
export function outfitReferenceReady(path: OutfitPath | undefined, input: DesignInput, reference: OutfitInspiration | undefined, succeeded: boolean, fetching: boolean) {
  if (!path) return true;
  if (path === 'free') return !input.outfitInspirationId && !input.outfitInspirationVersion;
  return !!input.outfitInspirationId && !!input.outfitInspirationVersion && succeeded && !fetching && !!reference?.image && reference.availability === 'AVAILABLE' && reference.id === input.outfitInspirationId && reference.version === input.outfitInspirationVersion;
}
