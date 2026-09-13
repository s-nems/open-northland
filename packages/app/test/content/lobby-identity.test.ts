import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLobbyCompatibility } from '../../src/content/lobby-identity.js';
import { contentDir, hasRealIr } from './helpers.js';

describe.runIf(hasRealIr())('lobby identity over generated content', () => {
  it('fingerprints both the owned IR and decoded map without exposing installation paths', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const path = String(input);
      try {
        const bytes = readFileSync(join(contentDir(), path));
        return new Response(bytes, { status: 200 });
      } catch {
        return new Response('', { status: 404 });
      }
    };
    const a = await loadLobbyCompatibility('magiczny_las', fetchImpl, 'test-build');
    const b = await loadLobbyCompatibility('magiczny_las', fetchImpl, 'test-build');
    expect(a).toEqual(b);
    expect(a.content).toMatch(/^[a-f0-9]{64}$/);
    expect(a.map).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a)).not.toContain(contentDir());
  });
});
