import { type MusicManifest, parseMusicManifest } from '@open-northland/audio';

/**
 * The rendered-music fetch boundary: the pipeline's `music/manifest.json`, or null when no music was
 * rendered (a checkout without it stays silent, music-wise, and still boots).
 */
export async function loadMusicManifest(fetchImpl: typeof fetch = fetch): Promise<MusicManifest | null> {
  try {
    const res = await fetchImpl('/music/manifest.json');
    if (!res.ok) return null;
    const read = parseMusicManifest(await res.json());
    if (read.manifest === null) console.warn(`[audio] music manifest rejected: ${read.rejected}`);
    return read.manifest;
  } catch {
    return null;
  }
}
