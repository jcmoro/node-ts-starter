export type Route = { slug: string };

export function currentRoute(): Route {
  const hash = window.location.hash.slice(1);
  const slug = hash.startsWith('/') ? hash.slice(1) : hash;
  return { slug };
}

export function navigate(slug: string): void {
  window.location.hash = `#/${slug}`;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
