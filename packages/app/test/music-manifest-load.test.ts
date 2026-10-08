import { describe, expect, it } from 'vitest';
import { loadMusicManifest } from '../src/content/music.js';
import { diag } from '../src/diag/index.js';

/** The rendered-music fetch: a manifest of another build's layout plays no music and says why. */

const serving = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

describe('loadMusicManifest', () => {
  it('logs why a manifest of another layout was rejected and plays no music', async () => {
    diag.setConsoleLevel('silent', 'audio');
    const from = diag.entries().length;
    expect(await loadMusicManifest(serving({ version: -1 }))).toBeNull();
    const logged = diag.entries().slice(from);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ channel: 'audio', level: 'warn', message: 'music manifest rejected' });
    expect(logged[0]?.data).toEqual({ reason: expect.any(String) });
  });
});
