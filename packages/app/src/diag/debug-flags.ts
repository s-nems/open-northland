/**
 * `?debug=` as a set. It used to be a single exact-match value, so turning on the running profile
 * would have silently switched off an active trace. Comma-separated and order-independent:
 * `?debug=profile,trace` runs both, and a bare `?debug=perf` still means what it always did.
 */

export function debugFlags(params: URLSearchParams): ReadonlySet<string> {
  const raw = params.get('debug');
  if (raw === null) return new Set();
  return new Set(
    raw
      .split(',')
      .map((flag) => flag.trim())
      .filter((flag) => flag !== ''),
  );
}

export function hasDebugFlag(params: URLSearchParams, flag: string): boolean {
  return debugFlags(params).has(flag);
}

/** Add or remove one flag, leaving its siblings alone. Deletes the param once nothing is left, so a
 *  toggled-off mode does not leave `?debug=` behind in the URL. */
export function setDebugFlag(params: URLSearchParams, flag: string, enabled: boolean): void {
  const flags = new Set(debugFlags(params));
  if (enabled) flags.add(flag);
  else flags.delete(flag);
  if (flags.size === 0) params.delete('debug');
  else params.set('debug', [...flags].join(','));
}
