import { Graphics, Mesh, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ChunkBatcher } from '../src/gpu/terrain/chunk-batcher.js';

/**
 * Overlays alpha-blend over whatever drew before them, so `children()` must return fallback, base,
 * overlay2, overlay1 whatever the push order, or layer-1 seams render under layer 2.
 */

/** One triangle whose first x coordinate tags which batch it came from. */
function pushTagged(
  batcher: ChunkBatcher,
  pageKey: string,
  layer: 'base' | 'overlay1' | 'overlay2',
  tag: number,
): void {
  const batch = batcher.batchFor(pageKey, Texture.WHITE.source, layer);
  batch.positions.push(tag, 0, tag + 1, 0, tag, 1);
  batch.uvs.push(0, 0, 0, 0, 0, 0);
  batch.indices.push(0, 1, 2);
}

function tagOf(child: unknown): number {
  if (!(child instanceof Mesh)) throw new Error('expected a Mesh');
  return (child.geometry.positions as Float32Array)[0] as number;
}

describe('ChunkBatcher paint order', () => {
  it('emits fallback → base pages → overlay2 → overlay1 regardless of push order', () => {
    const batcher = new ChunkBatcher();
    // The worst push order: top layer first, base last, fallback in the middle.
    pushTagged(batcher, 'tran_meadow.masked', 'overlay1', 300);
    pushTagged(batcher, 'tran_sand.masked', 'overlay2', 200);
    batcher.drawFallbackTriangle([0, 0, 1, 0, 0, 1], 0x123456);
    pushTagged(batcher, 'text_003', 'base', 100);
    pushTagged(batcher, 'text_005', 'base', 101);

    const children = batcher.children();
    expect(children[0]).toBeInstanceOf(Graphics); // the fallback always draws first (underneath)
    expect(children.slice(1).map(tagOf)).toEqual([100, 101, 200, 300]);
  });

  it('keeps one batch per (layer × page) - the same page on two layers stays two draws', () => {
    const batcher = new ChunkBatcher();
    pushTagged(batcher, 'tran_meadow.masked', 'overlay1', 1);
    pushTagged(batcher, 'tran_meadow.masked', 'overlay2', 2);
    pushTagged(batcher, 'tran_meadow.masked', 'overlay1', 3); // same layer+page → same batch
    const children = batcher.children();
    expect(children).toHaveLength(2);
    expect(children.map(tagOf)).toEqual([2, 1]); // overlay2 under overlay1
    expect((children[1] as Mesh).geometry.positions).toHaveLength(12); // two triangles merged
  });
});
