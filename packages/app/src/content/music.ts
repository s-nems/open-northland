import { type MusicManifest, parseMusicManifest } from '@open-northland/audio';
import { withBaseUrl } from '../base-url.js';

/**
 * The rendered-music fetch boundary: the pipeline's `music/manifest.json`, or null when no music was
 * rendered (a checkout without it stays silent, music-wise, and still boots).
 */
export async function loadMusicManifest(fetchImpl: typeof fetch = fetch): Promise<MusicManifest | null> {
  try {
    const res = await fetchImpl(withBaseUrl('/music/manifest.json'));
    if (!res.ok) return null;
    return parseMusicManifest(await res.json());
  } catch {
    return null;
  }
}
