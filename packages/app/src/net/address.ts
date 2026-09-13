export function relayAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}
