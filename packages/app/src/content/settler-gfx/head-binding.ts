import type {
  FrameListAnim,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteFrameRef,
} from '@open-northland/render/data';
import type { BobSeqRow } from '../ir/rows.js';
import { HEX_FACINGS } from './seq-anim.js';

/** One body clip's head overlay: the clip the source draws the head from, and the body clip's length. */
export interface HeadClip {
  readonly head: BobSeqRow;
  readonly bodyLength: number;
}

/**
 * Body clip start → the head clip the source overlays it with (`gfxbobseqhead`), over the rows `bodySeqs`
 * this body plays: the frankish spearman waits under the longbowman's head, as his head set draws no spear
 * frames. Original behavior, unconfirmed in the running game: the head draws that clip's frame at the
 * body's own list entry, and the body's own bob id where a record names no head clip. A start two playable
 * rows share moves only where both agree, so a head never follows a clip it was not authored for.
 */
export function headClips(
  bodySeqs: ReadonlyMap<string, BobSeqRow>,
  headSeqs: ReadonlyMap<string, string>,
  sequences: ReadonlyMap<string, BobSeqRow>,
): Map<number, HeadClip> {
  const byStart = new Map<number, Map<string, HeadClip | undefined>>();
  for (const [name, row] of bodySeqs) {
    const headSeq = headSeqs.get(name);
    const head = headSeq !== undefined ? sequences.get(headSeq) : undefined;
    const clips = byStart.get(row.start) ?? new Map<string, HeadClip | undefined>();
    clips.set(
      head === undefined ? 'own' : `${head.start}/${row.length}`,
      head === undefined ? undefined : { head, bodyLength: row.length },
    );
    byStart.set(row.start, clips);
  }
  const moved = new Map<number, HeadClip>();
  for (const [start, clips] of byStart) {
    const [clip] = clips.values();
    if (clips.size === 1 && clip !== undefined) moved.set(start, clip);
  }
  return moved;
}

/**
 * A body list entry read into a head clip of another length. Where both lay out six facing blocks the entry
 * keeps its facing and its point through that facing's motion. Departure: the original reads the head clip
 * at the entry itself, so the byzantine and saracen two-handers' heads turn through the facings mid-swing
 * and vanish past the shorter sword clip.
 */
function headOffset(offset: number, bodyLength: number, headLength: number): number {
  const bodyBlock = bodyLength / HEX_FACINGS;
  const headBlock = headLength / HEX_FACINGS;
  if (bodyLength === headLength || !Number.isInteger(bodyBlock) || !Number.isInteger(headBlock))
    return offset;
  const block = Math.floor(offset / bodyBlock);
  return block * headBlock + Math.floor(((offset % bodyBlock) * headBlock) / bodyBlock);
}

function headListRef(ref: FrameListAnim, { head, bodyLength }: HeadClip): FrameListAnim {
  const frameLists = ref.frameLists.map((list) =>
    list.map((offset) => headOffset(offset, bodyLength, head.length)),
  );
  return { ...ref, start: head.start, frameLists };
}

function headRef(ref: SpriteFrameRef, clips: ReadonlyMap<number, HeadClip>): SpriteFrameRef {
  if (typeof ref === 'number') return ref;
  const clip = clips.get(ref.start);
  if (clip === undefined) return ref;
  return 'frameLists' in ref ? headListRef(ref, clip) : { ...ref, start: clip.head.start };
}

function headLists(
  refs: readonly FrameListAnim[],
  clips: ReadonlyMap<number, HeadClip>,
): readonly FrameListAnim[] {
  return refs.map((ref) => {
    const clip = clips.get(ref.start);
    return clip === undefined ? ref : headListRef(ref, clip);
  });
}

/** `record` with every value mapped, keys kept. */
function mapRecord<V>(record: Readonly<Record<string | number, V>>, map: (value: V) => V): Record<string, V> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}

/**
 * The head overlay's binding: `binding` with every clip {@link headClips} moves read from its head clip, or
 * undefined when none moves and the head draws the body's own bob ids. Cart driving keeps the body's ids,
 * since no cart record names a head clip.
 */
export function headBinding(
  binding: SettlerStateBinding,
  clips: ReadonlyMap<number, HeadClip>,
): SettlerStateBinding | undefined {
  if (clips.size === 0) return undefined;
  const ref = (r: SpriteFrameRef): SpriteFrameRef => headRef(r, clips);
  const slots = (slot: { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }) => ({
    ...slot,
    ...(slot.idle !== undefined ? { idle: ref(slot.idle) } : {}),
    ...(slot.moving !== undefined ? { moving: ref(slot.moving) } : {}),
  });
  const { carrying, engaged, byAtomic, bySubClip, idleChoices, idleFidgets, running } = binding;
  return {
    ...binding,
    idle: ref(binding.idle),
    ...(idleChoices !== undefined ? { idleChoices: headLists(idleChoices, clips) } : {}),
    ...(idleFidgets !== undefined ? { idleFidgets: headLists(idleFidgets, clips) } : {}),
    ...(binding.moving !== undefined ? { moving: ref(binding.moving) } : {}),
    ...(running !== undefined ? { running: ref(running) } : {}),
    ...(binding.acting !== undefined ? { acting: ref(binding.acting) } : {}),
    ...(byAtomic !== undefined ? { byAtomic: mapRecord(byAtomic, ref) } : {}),
    ...(bySubClip !== undefined ? { bySubClip: mapRecord(bySubClip, ref) } : {}),
    ...(engaged !== undefined ? { engaged: slots(engaged) } : {}),
    ...(carrying !== undefined
      ? {
          carrying: {
            ...slots(carrying),
            ...(carrying.byGood !== undefined ? { byGood: mapRecord(carrying.byGood, slots) } : {}),
          },
        }
      : {}),
  };
}

/**
 * `head` with every per-good carry gait whose head frame is blank re-pointed at the plain walk's head, so
 * the carrier does not walk headless. The source names a head clip for most carry gaits (the stooped
 * `walk_iron_gold` head over stone), but the scout's and the druid's hat sets draw no carry heads at all.
 * Returns `head` by identity when nothing borrows.
 */
export function carryHeadFallback(head: SettlerStateBinding, headAtlas: SpriteAtlas): SettlerStateBinding {
  const byGood = head.carrying?.byGood;
  const walk = head.moving;
  if (byGood === undefined || walk === undefined || typeof walk === 'number' || 'frameLists' in walk) {
    return head;
  }
  let borrowed = false;
  const headed = mapRecord(byGood, (slot) => {
    const moving = slot.moving;
    if (moving === undefined || typeof moving === 'number') return slot;
    const frame = headAtlas.frames.get(moving.start);
    if (frame !== undefined && frame.width > 0 && frame.height > 0) return slot;
    borrowed = true;
    return { moving: walk, idle: { ...walk, frames: 1 } };
  });
  return borrowed ? { ...head, carrying: { ...head.carrying, byGood: headed } } : head;
}
