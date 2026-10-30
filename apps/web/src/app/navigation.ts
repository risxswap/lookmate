import { useCallback, useRef, useSyncExternalStore, type Dispatch, type SetStateAction, type MouseEvent } from 'react';

const navigationEvent = 'lookmate:navigate';
const sessionKey = 'lookmate:navigation:v1';
let session = sessionStorage.getItem(sessionKey);
if (!session) { session = crypto.randomUUID(); sessionStorage.setItem(sessionKey, session); }
type Entry = { index: number; href: string };
type NavigationState = { session: string; ancestors: Entry[] };
let routeGuard: ((url: URL) => boolean) | undefined;
let acceptedUrl = window.location.href;
let acceptedIndex = Number(window.history.state?.lookmateIndex ?? 0);
let restoring = false;
let backPending = false;
function navigationState(): NavigationState {
  const state = window.history.state?.lookmateNavigation;
  return state?.session === session ? state : { session: session!, ancestors: [] };
}
window.history.replaceState({ ...window.history.state, lookmateIndex: acceptedIndex, lookmateNavigation: navigationState() }, '', acceptedUrl);
export function clearNavigationSession() { sessionStorage.removeItem(sessionKey); }
export function setNavigationGuard(guard: (url: URL) => boolean) {
  routeGuard = guard;
  return () => { if (routeGuard === guard) routeGuard = undefined; };
}
window.addEventListener('popstate', event => {
  const url = new URL(window.location.href);
  backPending = false;
  // A cancelled browser Back is rolled forward without asking a second time.
  if (restoring && url.href === acceptedUrl && event.state?.lookmateIndex === acceptedIndex) {
    restoring = false;
    event.stopImmediatePropagation();
    return;
  }
  if (routeGuard && !routeGuard(url)) {
    event.stopImmediatePropagation();
    const targetIndex = event.state?.lookmateIndex;
    if (typeof targetIndex === 'number' && targetIndex !== acceptedIndex) {
      restoring = true;
      window.history.go(acceptedIndex - targetIndex);
    } else window.history.pushState({ ...window.history.state, lookmateIndex: acceptedIndex }, '', acceptedUrl);
    return;
  }
  acceptedUrl = url.href;
  acceptedIndex = Number(event.state?.lookmateIndex ?? acceptedIndex);
}, { capture: true });
const getLocation = () => window.location.href;
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(navigationEvent, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(navigationEvent, listener);
  };
}
export function useLocation() {
  return new URL(useSyncExternalStore(subscribe, getLocation));
}
function isWorkspaceUrl(url: URL) {
  return url.origin === window.location.origin && (url.pathname === '/app' || url.pathname.startsWith('/app/'));
}
export function navigate(url: URL, replace = false) {
  if (!isWorkspaceUrl(url) || url.href === window.location.href) return;
  if (routeGuard && !routeGuard(url)) return;
  const pathChanged = url.pathname !== window.location.pathname;
  const state = navigationState();
  if (replace) window.history.replaceState({ ...window.history.state, lookmateIndex: acceptedIndex, lookmateNavigation: state }, '', url);
  else {
    const ancestors = [...state.ancestors, { index: acceptedIndex, href: acceptedUrl }].slice(-100);
    acceptedIndex += 1;
    window.history.pushState({ lookmateIndex: acceptedIndex, lookmateNavigation: { session, ancestors } }, '', url);
  }
  acceptedUrl = url.href;
  window.dispatchEvent(new Event(navigationEvent));
  if (pathChanged) window.scrollTo(0, 0);
}
export function workspaceFallback(path: string) {
  if (path.startsWith('/app/outfit-design/')) return '/app/outfit-design';
  if (path.startsWith('/app/hairstyles/')) return '/app/hairstyles';
  if (/^\/app\/designs\/[^/]+$/.test(path)) return '/app/designs';
  if (/^\/app\/wardrobe\/outfits\/[^/]+(?:\/edit)?$/.test(path) && path !== '/app/wardrobe/outfits/new') return '/app/wardrobe?tab=outfits';
  return '/app';
}
export function goBack(fallback?: string) {
  if (backPending || restoring) return;
  // Only entries recorded by our own navigation are eligible, never referrer/history.length.
  const target = [...navigationState().ancestors].reverse().find(entry => {
    const url = new URL(entry.href);
    return entry.index < acceptedIndex && isWorkspaceUrl(url) && url.pathname !== window.location.pathname;
  });
  if (target) {
    backPending = true;
    window.history.go(target.index - acceptedIndex);
  } else navigate(new URL(fallback || workspaceFallback(window.location.pathname), window.location.origin), true);
}
// View state belongs to a history entry and account. It survives unmount/reload,
// but does not copy filters into a newly visited page or store unsaved form drafts.
export function usePageState<T>(scope: string, key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef(initial);
  const read = useCallback((): T => window.history.state?.lookmateView?.[scope]?.[key] ?? fallback.current, [scope, key]);
  const value = useSyncExternalStore(subscribe, read);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(read()) : next;
    if (Object.is(value, read())) return;
    const views = window.history.state?.lookmateView ?? {};
    window.history.replaceState({ ...window.history.state, lookmateView: { ...views, [scope]: { ...views[scope], [key]: value } } }, '', window.location.href);
    window.dispatchEvent(new Event(navigationEvent));
  }, [scope, key, read]);
  return [value, setValue];
}
export function replaceTab(tab: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  navigate(url, true);
}
// Keep real links for native new-tab, keyboard and modified-click behavior.
export function handleWorkspaceLink(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
  const url = new URL(anchor.href);
  if (!isWorkspaceUrl(url)) return;
  // Leave same-page fragment links to the browser's native anchor behavior.
  if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
  event.preventDefault();
  navigate(url);
}
