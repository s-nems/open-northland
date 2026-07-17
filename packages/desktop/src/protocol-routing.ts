/**
 * The content-route path an `app://` request maps to, or `undefined` for the routeless setup host.
 * Pixi's path resolver mis-joins root-relative asset URLs on a custom scheme: a worker-side
 * `/bobs/<stem>.png` arrives as `app://bobs/<stem>.png` — the route segment lands in the URL host, so
 * folding it back into the pathname makes both spellings hit the same route table. Kept free of
 * `electron` imports so the rule stays unit-testable.
 */
export function routePathOf(host: string, rawPathname: string): string | undefined {
  if (host === 'game') return rawPathname;
  if (host === 'setup') return undefined;
  return `/${host}${rawPathname}`;
}
