import type { QueryClient } from '@tanstack/react-query';
import { refreshCsrf } from '../../api/client';
import { clearNavigationSession } from '../../app/navigation';
import { clearGenerationRecovery } from '../generation/api';
import { clearHairDrafts } from '../hairstyles/drafts';
import { clearOutfitDrafts } from '../outfitInspirations/drafts';
import { clearOutfitRecovery } from '../outfits/api';
import { clearPlannerRecovery } from '../planner/api';
import { loginUrl } from './navigation';

export type SessionEnd = 'expired' | 'logout' | 'passwordChanged';

function clearLocalSession(client: QueryClient) {
  client.clear();
  clearHairDrafts();
  clearOutfitDrafts();
  try {
    sessionStorage.removeItem('lookmate:hadSession');
    clearNavigationSession();
    clearGenerationRecovery();
    clearOutfitRecovery();
    clearPlannerRecovery();
  } catch { /* An unavailable browser store must not prevent the redirect. */ }
}

export async function endSession(client: QueryClient, reason: SessionEnd) {
  let destination = '/login';
  if (reason === 'passwordChanged') destination = '/login?passwordChanged=1';
  if (reason === 'expired') {
    let hadSession = false;
    try { hadSession = sessionStorage.getItem('lookmate:hadSession') === '1'; } catch { /* No session marker. */ }
    destination = loginUrl(hadSession);
  }
  try {
    await client.cancelQueries();
    if (reason === 'logout') {
      clearLocalSession(client);
      await refreshCsrf().catch(() => {});
    }
  } finally {
    // An in-flight operation can settle while logout is refreshing CSRF.
    clearLocalSession(client);
    window.location.replace(destination);
  }
}
