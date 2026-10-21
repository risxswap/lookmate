import { useSyncExternalStore, type MouseEvent } from 'react';

const navigationEvent = 'lookmate:navigate';
let routeGuard: ((url: URL) => boolean) | undefined;
let acceptedUrl = window.location.href;
let acceptedIndex = Number(window.history.state?.lookmateIndex ?? 0);
window.history.replaceState({ ...window.history.state, lookmateIndex: acceptedIndex }, '', acceptedUrl);
export function setNavigationGuard(guard: (url: URL) => boolean) {
  routeGuard = guard;
  return () => { if (routeGuard === guard) routeGuard = undefined; };
}
window.addEventListener('popstate', event => {
  const url = new URL(window.location.href);
  if (routeGuard && !routeGuard(url)) {
    event.stopImmediatePropagation();
    const targetIndex = event.state?.lookmateIndex;
    if (typeof targetIndex === 'number' && targetIndex !== acceptedIndex) window.history.go(acceptedIndex - targetIndex);
    else window.history.pushState({ ...window.history.state, lookmateIndex: acceptedIndex }, '', acceptedUrl);
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
  if (replace) window.history.replaceState({ ...window.history.state, lookmateIndex: acceptedIndex }, '', url);
  else { acceptedIndex += 1; window.history.pushState({ lookmateIndex: acceptedIndex }, '', url); }
  acceptedUrl = url.href;
  window.dispatchEvent(new Event(navigationEvent));
  if (pathChanged) window.scrollTo(0, 0);
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
