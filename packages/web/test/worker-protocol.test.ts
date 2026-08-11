import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../src/opfs-layout.js';
import { pipelineArgsOf } from '../src/worker/protocol.js';

describe('pipelineArgsOf', () => {
  it('re-roots every OPFS path under the data mount', () => {
    const noMod = pipelineArgsOf({ kind: 'run', game: new Map(), modRoot: undefined, locale: 'eng' });
    expect(noMod).toEqual({ game: '/game', out: `/data/${CONTENT_DIR}`, modRoot: undefined });

    // Mod roots stay OPFS-root-relative (`open-northland/mods/…`) until the worker re-roots them.
    const withMod = pipelineArgsOf({
      kind: 'run',
      game: new Map(),
      modRoot: 'open-northland/mods/CnMod 1.3.1',
      locale: 'eng',
    });
    expect(withMod.modRoot).toBe('/data/open-northland/mods/CnMod 1.3.1');
  });
});
