import type { SpriteAtlas } from '@open-northland/render/data';
import type { GfxAtomicProgram } from '../ir/joins.js';
import type { BobSeqRow } from '../ir/rows.js';
import { programFrameLists } from './seq-anim.js';

/**
 * The per-facing lists a program plays on this body ({@link programFrameLists}), when every frame they
 * address is a bob the body draws. An offset inside the row is drawable by construction, since the rows come
 * from `playableSequences`; one past it has to be proven, because a program can outrun its row in
 * either direction. The werewolf's attack record names the weresnake's 256-frame clip and lays its facings
 * out over its own 264-frame fight, whose extra frames are drawn, while a tribe naming a clip a shorter body
 * carries runs off its pool into blank bobs, which the renderer draws as the missing-sprite placeholder.
 */
export function playableLists(
  program: GfxAtomicProgram | undefined,
  row: BobSeqRow,
  atlas: SpriteAtlas | undefined,
): readonly (readonly number[])[] | undefined {
  if (program === undefined || row.length <= 0) return undefined;
  const lists = programFrameLists(program.dirFrames, row.length);
  for (const list of lists) {
    for (const offset of list) {
      if (offset < row.length) continue;
      const frame = atlas?.frames.get(row.start + offset);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return undefined;
    }
  }
  return lists;
}
