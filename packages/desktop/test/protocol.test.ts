import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAppProtocol } from '../src/protocol.js';
import { externalPageUrl, initialGameUrl, isAppUrl, routePathOf } from '../src/protocol-routing.js';

type AppHandler = (request: Request) => Promise<Response>;
const installed = vi.hoisted(() => ({ handler: undefined as AppHandler | undefined }));
vi.mock('electron', () => ({
  protocol: {
    handle: (_scheme: string, handler: AppHandler) => {
      installed.handler = handler;
    },
  },
}));

/**
 * Pixi workers mis-join root-relative asset URLs on a custom scheme, so `/bobs/x.png` arrives as
 * `app://bobs/x.png` with the route segment in the URL host.
 */
describe('routePathOf', () => {
  it('passes game-host pathnames through untouched', () => {
    expect(routePathOf('game', '/bobs/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('game', '/index.html')).toBe('/index.html');
  });

  it('folds a mangled route-segment host back into the pathname', () => {
    expect(routePathOf('bobs', '/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('maps', '/campaign01.json')).toBe('/maps/campaign01.json');
    expect(routePathOf('assets', '/gravel-DqJ8dxXq.png')).toBe('/assets/gravel-DqJ8dxXq.png');
  });

  it('keeps the raw pathname raw - the file lookup decodes it', () => {
    expect(routePathOf('game', '/maps/two%20words.json')).toBe('/maps/two%20words.json');
  });
});

describe('isAppUrl', () => {
  it('accepts the game pages it serves', () => {
    expect(isAppUrl('app://game/index.html')).toBe(true);
    expect(isAppUrl('app://game/index.html?map=campaign01')).toBe(true);
  });

  it('rejects remote and local-file origins', () => {
    expect(isAppUrl('https://example.com/page')).toBe(false);
    expect(isAppUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects a caller that reports no URL', () => {
    expect(isAppUrl(undefined)).toBe(false);
    expect(isAppUrl('')).toBe(false);
  });

  it('requires the full scheme separator, not the scheme spelling alone', () => {
    expect(isAppUrl('app:/game')).toBe(false);
    expect(isAppUrl('application://game/index.html')).toBe(false);
  });
});

describe('links the game opens', () => {
  it('hands web pages to the system browser and nothing else', () => {
    expect(externalPageUrl('https://culturesnation.pl/mapy/zatoka')).toBe(
      'https://culturesnation.pl/mapy/zatoka',
    );
    expect(externalPageUrl('http://example.org/a')).toBe('http://example.org/a');
    expect(externalPageUrl('file:///etc/passwd')).toBeNull();
    expect(externalPageUrl('app://game/index.html')).toBeNull();
    expect(externalPageUrl('javascript:alert(1)')).toBeNull();
    expect(externalPageUrl('not a url')).toBeNull();
  });

  it('passes a catalogue server override to the first page as ?api=', () => {
    const game = 'app://game/index.html';
    expect(initialGameUrl(game, undefined)).toBe(game);
    expect(initialGameUrl(game, 'file:///x')).toBe(game);
    expect(initialGameUrl(game, 'http://127.0.0.1:8790')).toBe(
      'app://game/index.html?api=http%3A%2F%2F127.0.0.1%3A8790%2F',
    );
  });
});

describe('app protocol media', () => {
  const SOUND_BYTES = 512;
  const SOUND_PATH = '/campaigns/test/eng/intro.webm';
  let contentRoot: string;

  beforeAll(async () => {
    contentRoot = await mkdtemp(join(tmpdir(), 'app-protocol-'));
    const file = join(contentRoot, SOUND_PATH);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, new Uint8Array(SOUND_BYTES));
    handleAppProtocol({ appRoot: join(contentRoot, 'app'), contentRoot });
  });
  afterAll(() => rm(contentRoot, { recursive: true, force: true }));

  it('answers a ranged read of a film sound track with 206 and a webm type', async () => {
    const handler = installed.handler;
    if (handler === undefined) throw new Error('no app protocol handler');
    const response = await handler(
      new Request(`app://game${SOUND_PATH}`, { headers: { range: 'bytes=100-199' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toMatch(/^(audio|video)\/webm$/);
    expect(response.headers.get('content-range')).toBe(`bytes 100-199/${SOUND_BYTES}`);
  });
});
