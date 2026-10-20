export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || !(target.pathname === '/app' || target.pathname.startsWith('/app/'))) return '/app';
    return target.pathname + target.search + target.hash;
  } catch { return '/app'; }
}
export function loginUrl(expired: boolean) {
  const params = new URLSearchParams({ returnTo: window.location.pathname + window.location.search + window.location.hash });
  if (expired) params.set('expired', '1');
  return `/login?${params}`;
}
