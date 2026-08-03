/** `?debug=` is a comma-separated, order-independent set of flags. */

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

export function setDebugFlag(params: URLSearchParams, flag: string, enabled: boolean): void {
  const flags = new Set(debugFlags(params));
  if (enabled) flags.add(flag);
  else flags.delete(flag);
  if (flags.size === 0) params.delete('debug');
  else params.set('debug', [...flags].join(','));
}
