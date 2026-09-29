import type { AtlasFrame, SpriteAtlas } from '@open-northland/render/data';
import type { BobSeqRow } from '../ir/rows.js';
import { HEX_FACINGS } from './seq-anim.js';

function drawn(atlas: SpriteAtlas, id: number): AtlasFrame | undefined {
  const frame = atlas.frames.get(id);
  return frame !== undefined && frame.width > 0 && frame.height > 0 ? frame : undefined;
}

/** The `stand` frame facing the same way as entry `offset` of `clip`, or undefined when either clip does
 *  not lay out six equal facing blocks. */
function standInId(clip: BobSeqRow, offset: number, stand: BobSeqRow): number | undefined {
  const clipBlock = clip.length / HEX_FACINGS;
  const standBlock = stand.length / HEX_FACINGS;
  if (!Number.isInteger(clipBlock) || !Number.isInteger(standBlock)) return undefined;
  return stand.start + Math.floor(offset / clipBlock) * standBlock;
}

/**
 * `head` with every body clip it draws no frame of filled from `donors`, the other head sets on the same
 * body: the head's own `stand` frame in that facing, placed where the first donor drawing the frame puts
 * its head, less the two heads' anchor difference in that stand frame. A clip without six facing blocks
 * draws the donor's head itself. The frankish, saracen and byzantine women's head sets draw no kiss frames,
 * and the byzantine one no sleep frames, over the shared woman body. Approximation: the head keeps its
 * upright stand pose through the body's lean. Returns `head` by identity when nothing borrows.
 */
export function borrowedHeadAtlas(
  head: SpriteAtlas,
  donors: readonly SpriteAtlas[],
  clips: Iterable<BobSeqRow>,
  stand: BobSeqRow,
): SpriteAtlas {
  let frames: Map<number, AtlasFrame> | undefined;
  for (const clip of clips) {
    let blank = true;
    for (let offset = 0; offset < clip.length && blank; offset++) {
      if (drawn(head, clip.start + offset) !== undefined) blank = false;
    }
    if (!blank) continue;
    for (let offset = 0; offset < clip.length; offset++) {
      const standId = standInId(clip, offset, stand);
      const own = standId === undefined ? undefined : drawn(head, standId);
      const id = clip.start + offset;
      for (const donor of donors) {
        const pose = drawn(donor, id);
        if (pose === undefined) continue;
        const donorStand = standId === undefined ? undefined : drawn(donor, standId);
        frames ??= new Map(head.frames);
        frames.set(
          id,
          own === undefined || donorStand === undefined
            ? pose
            : {
                ...own,
                offsetX: pose.offsetX + own.offsetX - donorStand.offsetX,
                offsetY: pose.offsetY + own.offsetY - donorStand.offsetY,
              },
        );
        break;
      }
    }
  }
  return frames === undefined ? head : { ...head, frames };
}
