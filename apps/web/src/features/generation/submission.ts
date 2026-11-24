import type { QueryClient } from '@tanstack/react-query';
import { completeHairSubmission } from '../hairstyles/drafts';
import { completeOutfitSubmission } from '../outfitInspirations/drafts';
import { clearPending, readPending, type PendingSubmission } from './api';

export function finishSubmission(client: QueryClient, operation: PendingSubmission) {
  const { accountId, key } = operation;
  if (readPending(accountId)?.key !== key) return false;
  clearPending(accountId);
  completeHairSubmission(accountId, operation);
  completeOutfitSubmission(accountId, operation);
  void client.invalidateQueries({ queryKey: ['designs', accountId] });
  void client.invalidateQueries({ queryKey: ['workspace', accountId] });
  return true;
}
