import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLobbyCompatibility } from '../../src/content/lobby-identity.js';
import * as modStore from '../../src/content/mods/store.js';
import { verifyMapDocuments } from '../../src/content/transfer/index.js';
import { contentFetch } from '../../src/content/url.js';

const IR = parseContentSet({
  manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
  goods: [],
  jobs: [],
  buildings: [],
});
const MAP = { width: 1, height: 1, typeIds: [0] };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fetchFiles(files: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const path = String(input);
    return Object.hasOwn(files, path)
      ? new Response(JSON.stringify(files[path]), { status: 200 })
      : new Response('', { status: 404 });
  };
}

function identity(extra: Record<string, unknown> = {}) {
  return loadLobbyCompatibility(
    'island',
    fetchFiles({ '/ir.json': IR, '/maps/island.json': MAP, ...extra }),
    'build-a',
  );
}

describe('lobby world identity', () => {
  it('detects edited map cells and scripts independently from content', async () => {
    const original = await identity();
    const changedMap = await identity({ '/maps/island.json': { ...MAP, typeIds: [1] } });
    const changedScript = await identity({ '/maps/island.script.json': { players: [] } });
    expect(changedMap.map).not.toBe(original.map);
    expect(changedScript.map).not.toBe(original.map);
    expect(changedMap.content).toBe(original.content);
  });

  it('ignores owner-specific paths', async () => {
    const original = await identity();
    const moved = structuredClone(IR);
    moved.manifest.generatedFrom.data = '/another/owner';
    expect((await identity({ '/ir.json': moved })).content).toBe(original.content);
  });

  it('checks the names used by authored placement joins', async () => {
    const goods = [{ typeId: 1, id: 'water', name: 'water' }];
    const a = await identity({ '/ir.json': { ...IR, goods } });
    const b = await identity({ '/ir.json': { ...IR, goods: [{ ...goods[0], name: 'spring' }] } });
    expect(a.content).not.toBe(b.content);
  });

  it('includes the selected mod archives in world compatibility', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(IR), { status: 200 }));
    vi.spyOn(modStore, 'activeContentModIds')
      .mockResolvedValueOnce(['a'.repeat(64)])
      .mockResolvedValueOnce(['b'.repeat(64)]);
    const documents = verifyMapDocuments('island', MAP, null);
    const first = await loadLobbyCompatibility('island', contentFetch, 'build-a', documents);
    const second = await loadLobbyCompatibility('island', contentFetch, 'build-a', documents);
    expect(first.content).not.toBe(second.content);
  });

  it('reports retained verified inputs without re-fetching map or script', async () => {
    const source = verifyMapDocuments('island', MAP, null);
    const identity = await loadLobbyCompatibility(
      'island',
      fetchFiles({ '/ir.json': IR }),
      'build-a',
      source,
    );
    expect(identity.map).toBe(source.fingerprint);
    const missing = await loadLobbyCompatibility(
      'island',
      fetchFiles({ '/ir.json': IR, '/maps/island.json': MAP }),
      'build-a',
      null,
    );
    expect(missing.map).toBeNull();
  });

  it('reports absent maps and rejects malformed sidecars or missing content', async () => {
    const missing = await loadLobbyCompatibility('island', fetchFiles({ '/ir.json': IR }), 'test');
    expect(missing.map).toBeNull();
    await expect(identity({ '/maps/island.script.json': { players: 'invalid' } })).rejects.toThrow();
    await expect(loadLobbyCompatibility('island', fetchFiles({}), 'test')).rejects.toThrow(
      'Missing game content',
    );
    await expect(loadLobbyCompatibility('../private', fetchFiles({}), 'test')).rejects.toThrow(
      'Invalid lobby map',
    );
  });
});
