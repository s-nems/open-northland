import { describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '../src/opfs-layout.js';
import { pipelineArgsOf } from '../src/worker/protocol.js';

describe('pipelineArgsOf', () => {
  it('re-roots every OPFS path under the data mount', () => {
    const noMod = pipelineArgsOf({ kind: 'run', game: new Map(), modRoot: undefined });
    expect(noMod).toEqual({ game: '/game', out: `/data/${CONTENT_DIR}`, modRoot: undefined });

    // The shell hands OPFS-root-relative roots (`open-northland/mods/…`); losing the data-dir
    // prefix here once cost every external-mod conversion.
    const withMod = pipelineArgsOf({
      kind: 'run',
      game: new Map(),
      modRoot: 'open-northland/mods/CnMod 1.3.1',
    });
    expect(withMod.modRoot).toBe('/data/open-northland/mods/CnMod 1.3.1');
  });
});
