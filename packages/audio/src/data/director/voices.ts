import { type AnimalCall, type HumanVoices, VOICE_CLASSES } from '@open-northland/data';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { groupFiles, poolGain, type SoundIndex } from '../bank.js';
import { creatureTribe, entityOwner, entityTile, isPerson } from '../snapshot.js';
import { computeSpatial } from '../spatial.js';
import type { ChatterInput, DirectorInput, Lane, OneShot } from '../types.js';
import { humanVoicesOf } from '../voices.js';
import { groupAnswerShots, selectionShots } from './group-answer.js';

/**
 * The creatures' own voices, none of them a sim event: a settler answering the player's order, the idle
 * natter of the humans on screen, and the animals' calls. Rules follow the original's behavior; the
 * tables are the mod's `humans/sounds.cif` and `animals/sounds.ini`.
 */

/**
 * The die a generic human voice rolls each game tick: a tribe-and-class pool speaks when
 * `random * GENERIC_ROLL_RANGE < drawn count`, so ten men on screen natter about once every 17 seconds at
 * 12 ticks a second and a crowd of two hundred every second (the original rolls `rand() % 2000`).
 */
export const GENERIC_ROLL_RANGE = 2000;
/** The die an animal call rolls each game tick against its `probability` (the original rolls `rand() % 1000`). */
export const ANIMAL_ROLL_RANGE = 1000;
/**
 * Most game ticks one frame rolls for: a long hitch or a fast-forward advances more, but the original
 * rolled once per rendered tick and never caught up, so the surplus is dropped rather than compressed
 * into a burst.
 */
export const MAX_CHATTER_TICKS_PER_FRAME = 5;

/**
 * The answers to this frame's orders, panned but neither culled nor attenuated, so a group ordered off
 * screen still answers. Orders given in one frame answer as one group ({@link groupAnswerShots}), with
 * the first fallback cue among them; an order every member refused answers only when nothing was
 * accepted beside it. In no lane: an answer to the player's own click is never rationed away.
 */
export function responseShots(input: DirectorInput): OneShot[] {
  const responses = input.responses;
  if (responses === undefined || responses.length === 0) return [];
  const accepted = responses.filter((answer) => answer.refused !== true);
  if (accepted.length === 0) return responses.flatMap((answer) => groupAnswerShots(input, answer));
  const members = new Set(accepted.flatMap((answer) => answer.members));
  const fallback = accepted.find((answer) => answer.fallback !== undefined)?.fallback;
  return groupAnswerShots(input, { members: [...members], ...(fallback === undefined ? {} : { fallback }) });
}

/** The acknowledgement of this frame's selection, if the player took one ({@link selectionShots}). */
export function selectionVoiceShots(input: DirectorInput): OneShot[] {
  return input.selection === undefined ? [] : selectionShots(input, input.selection);
}

/** A chatter pool or a calling herd and the ids of its creatures drawn this frame. */
interface Voiced<T> {
  readonly source: T;
  readonly files: readonly string[];
  readonly ids: number[];
}

/**
 * The index's chatter pools in the order the original polls them (tribe, then child / female / male)
 * and its calling herds, each with an id list the frame refills, so counting the drawn creatures
 * allocates nothing once a pool has been seen.
 */
interface ChatterTally {
  readonly pools: readonly Voiced<HumanVoices>[];
  readonly poolOf: ReadonlyMap<HumanVoices, number[]>;
  readonly herds: readonly Voiced<AnimalCall>[];
  readonly herdOf: ReadonlyMap<number, number[]>;
}

const tallies = new WeakMap<SoundIndex, ChatterTally>();

function tallyFor(index: SoundIndex): ChatterTally {
  const known = tallies.get(index);
  if (known !== undefined) return known;
  const pools: Voiced<HumanVoices>[] = [];
  const seen = new Set<HumanVoices>(); // a tribe that borrows its voices shares its lender's rows
  for (const byClass of index.humanVoices.values()) {
    for (const voices of byClass.values()) {
      const files = voices.generic === undefined ? undefined : groupFiles(index, voices.generic);
      if (files === undefined || seen.has(voices)) continue;
      seen.add(voices);
      pools.push({ source: voices, files, ids: [] });
    }
  }
  const pollOrder = (v: HumanVoices): number =>
    v.tribe * VOICE_CLASSES.length + VOICE_CLASSES.indexOf(v.voiceClass);
  pools.sort((a, b) => pollOrder(a.source) - pollOrder(b.source));
  const herds: Voiced<AnimalCall>[] = [];
  for (const call of index.animalCalls.values()) {
    const files = groupFiles(index, call.group);
    if (files !== undefined) herds.push({ source: call, files, ids: [] });
  }
  const tally: ChatterTally = {
    pools,
    poolOf: new Map(pools.map((pool) => [pool.source, pool.ids])),
    herds,
    herdOf: new Map(herds.map((herd) => [herd.source.tribe, herd.ids])),
  };
  tallies.set(index, tally);
  return tally;
}

/**
 * Count the drawn creatures that may speak into the index's tally: the local player's own people with
 * a chatter pool (the original searches its own humans' sector lists) and every animal of a calling
 * tribe. Only ids are kept; a speaker's position is read once a roll picks it.
 */
function tallyDrawn(
  snapshot: WorldSnapshot,
  index: SoundIndex,
  drawn: Iterable<number>,
  localPlayer: number | undefined,
): ChatterTally {
  const tally = tallyFor(index);
  for (const pool of tally.pools) pool.ids.length = 0;
  for (const herd of tally.herds) herd.ids.length = 0;
  for (const id of drawn) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    const tribe = creatureTribe(e.components);
    if (tribe === undefined) continue;
    if (isPerson(e.components)) {
      if (localPlayer === undefined || entityOwner(e.components) !== localPlayer) continue;
      const voices = humanVoicesOf(index, e);
      if (voices !== undefined) tally.poolOf.get(voices)?.push(id);
    } else {
      tally.herdOf.get(tribe)?.push(id);
    }
  }
  return tally;
}

const VOICE_LANE: Lane = { kind: 'voice' };

/** A positioned, self-exclusive one-shot at a picked speaker in the voice lane, or null when it has no
 *  position or stands off screen or in the fog. */
function speakerShot(
  input: DirectorInput,
  id: number,
  files: readonly string[],
  key: string,
): OneShot | null {
  const e = entityById(input.snapshot, id);
  const tile = e === undefined ? null : entityTile(e.components);
  if (tile === null) return null;
  const { camera, canvasW, canvasH, visibleTile } = input;
  if (visibleTile !== undefined && !visibleTile(tile.col, tile.row)) return null;
  const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
  if (spatial === null) return null;
  const gain = spatial.gain * poolGain(input.index, files);
  return { files, gain, pan: spatial.pan, key, exclusive: 'wav', lane: VOICE_LANE };
}

/** One of a group's ids, picked by the roll source. */
function pickOne(ids: readonly number[], random: () => number): number | undefined {
  return ids[Math.floor(random() * ids.length)];
}

/**
 * One game tick's roll of the idle human voices: one die against every tribe-and-class pool's head count
 * in poll order, and the first pool the die lands under speaks through one of its people, picked at
 * random (approximation: the original takes the first of them its sector scan meets). At most one line a
 * tick, and a crowd of many pools is no chattier than its largest pool.
 */
function genericRoll(input: DirectorInput, chatter: ChatterInput, tally: ChatterTally): OneShot | null {
  const die = Math.floor(chatter.random() * GENERIC_ROLL_RANGE);
  for (const pool of tally.pools) {
    if (die >= pool.ids.length) continue;
    const speaker = pickOne(pool.ids, chatter.random);
    if (speaker === undefined) continue;
    return speakerShot(input, speaker, pool.files, `generic:${pool.source.generic}`);
  }
  return null;
}

/**
 * One game tick's roll of the animal calls: each drawn animal tribe with at least its `minCount` on screen
 * rolls its `probability` in {@link ANIMAL_ROLL_RANGE} (inclusive, as the original compares), and a winner
 * calls through one of its animals picked at random.
 */
function animalRoll(input: DirectorInput, chatter: ChatterInput, tally: ChatterTally, out: OneShot[]): void {
  for (const herd of tally.herds) {
    const call = herd.source;
    if (herd.ids.length === 0 || herd.ids.length < call.minCount) continue;
    if (Math.floor(chatter.random() * ANIMAL_ROLL_RANGE) > call.probability) continue;
    const caller = pickOne(herd.ids, chatter.random);
    if (caller === undefined) continue;
    const shot = speakerShot(input, caller, herd.files, `animal:${call.group}`);
    if (shot !== null) out.push(shot);
  }
}

/** The unprompted voices this frame: the human natter and animal calls of the drawn creatures, rolled once
 *  per game tick the frame advanced (capped at {@link MAX_CHATTER_TICKS_PER_FRAME}). */
export function chatterShots(input: DirectorInput): OneShot[] {
  const chatter = input.chatter;
  if (chatter === undefined || chatter.ticks <= 0) return [];
  const ticks = Math.min(chatter.ticks, MAX_CHATTER_TICKS_PER_FRAME);
  const tally = tallyDrawn(input.snapshot, input.index, chatter.drawn(), input.localPlayer);
  const shots: OneShot[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const line = genericRoll(input, chatter, tally);
    if (line !== null) shots.push(line);
    animalRoll(input, chatter, tally, shots);
  }
  return shots;
}
