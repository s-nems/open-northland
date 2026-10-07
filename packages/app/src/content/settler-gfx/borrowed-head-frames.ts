import type { AtlasFrame, SpriteAtlas } from '@open-northland/render/data';
import type { BobSeqRow } from '../ir/rows.js';
import { FACING, HEX_FACINGS } from './seq-anim.js';
import { SHOVEL_SEQ } from './sequences.js';

function drawn(atlas: SpriteAtlas, id: number): AtlasFrame | undefined {
  const frame = atlas.frames.get(id);
  return frame !== undefined && frame.width > 0 && frame.height > 0 ? frame : undefined;
}

/** The matching walk pose for a supported clip layout. */
function walkFrameId(clip: BobSeqRow, offset: number, walk: BobSeqRow): number | undefined {
  // The 16-frame brewing strip faces NE, as does the cauldron's direction-5 work window.
  // Approximation: keep the druid's own walk head/hat, following the donor head's authored motion.
  if (clip.name === 'human_man_Druid_work' && clip.length === 16 && walk.length % 8 === 0)
    return walk.start + FACING.NE * (walk.length / 8);
  // The shovel's 92 frames form four 23-frame strips: W, E, S and N in the decoded art.
  // Its gfxanimframelistdir lists share the S/N strips between the diagonal facings.
  if (clip.name === SHOVEL_SEQ && clip.length === 92 && walk.length % 8 === 0) {
    const facing = [FACING.W, FACING.E, FACING.S, FACING.N][Math.floor(offset / 23)];
    return facing === undefined ? undefined : walk.start + facing * (walk.length / 8);
  }
  const clipBlock = clip.length / HEX_FACINGS;
  const walkBlock = walk.length / HEX_FACINGS;
  if (!Number.isInteger(clipBlock) || !Number.isInteger(walkBlock)) return undefined;
  return walk.start + Math.floor(offset / clipBlock) * walkBlock;
}

/**
 * `head` with supported body clips it draws no frame of filled from `donors`, the other head sets on
 * the same body: the head's own first `walk` frame in that facing, placed where the first donor drawing the
 * frame puts its head, less the two heads' anchor difference in that walk frame. Only the head's own frames
 * are used, since each head set is its own sheet. The frankish, saracen and byzantine women's head sets
 * draw no kiss frames, and the byzantine one no sleep frames, over the shared woman body. Approximation:
 * the head keeps its upright walk pose through the body's lean. Returns `head` by identity when nothing
 * borrows.
 */
export function borrowedHeadAtlas(
  head: SpriteAtlas,
  donors: readonly SpriteAtlas[],
  clips: Iterable<BobSeqRow>,
  walk: BobSeqRow,
): SpriteAtlas {
  let frames: Map<number, AtlasFrame> | undefined;
  for (const clip of clips) {
    let blank = true;
    for (let offset = 0; offset < clip.length && blank; offset++) {
      if (drawn(head, clip.start + offset) !== undefined) blank = false;
    }
    if (!blank) continue;
    for (let offset = 0; offset < clip.length; offset++) {
      const walkId = walkFrameId(clip, offset, walk);
      const own = walkId === undefined ? undefined : drawn(head, walkId);
      if (walkId === undefined || own === undefined) continue;
      const id = clip.start + offset;
      for (const donor of donors) {
        const pose = drawn(donor, id);
        const donorWalk = drawn(donor, walkId);
        if (pose === undefined || donorWalk === undefined) continue;
        frames ??= new Map(head.frames);
        frames.set(id, {
          ...own,
          offsetX: pose.offsetX + own.offsetX - donorWalk.offsetX,
          offsetY: pose.offsetY + own.offsetY - donorWalk.offsetY,
        });
        break;
      }
    }
  }
  return frames === undefined ? head : { ...head, frames };
}
