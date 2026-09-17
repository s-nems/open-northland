import { type HumanVoices, VOICE_CLASSES } from '@open-northland/data';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { groupFiles, type SoundIndex } from '../bank.js';
import { creatureTribe, entityOwner, entityTile, isPerson, type TilePoint } from '../snapshot.js';
import { computePan, computeSpatial } from '../spatial.js';
import type { ChatterInput, DirectorInput, OneShot } from '../types.js';
import { humanVoicesOf, responseGroup } from '../voices.js';
import { SFX_GAIN } from './events.js';

/**
 * The creatures' own voices, none of them a sim event: a settler answering the player's order, the idle
 * natter of the humans on screen, and the animals' calls. Byte evidence throughout is the owned macOS
 * `the original` (`CE2HumanSoundManager`, `CE2AnimalSoundManager`), the tables the mod's `humans/sounds.cif`
 * and `animals/sounds.ini`.
 */

/**
 * The die a generic human voice rolls each game tick: a tribe-and-class pool speaks when
 * `random * GENERIC_ROLL_RANGE < drawn count`, so ten men on screen natter about once every 17 seconds at
 * 12 ticks a second and a crowd of two hundred every second (`PlayGenericSounds`: `rand() % 2000`).
 */
export const GENERIC_ROLL_RANGE = 2000;
/** The die an animal call rolls each game tick against its `probability` (`PlayAnimalSounds`: `rand() % 1000`). */
export const ANIMAL_ROLL_RANGE = 1000;
/**
 * Most game ticks one frame rolls for: a long hitch or a fast-forward advances more, but the original
 * rolled once per rendered tick and never caught up, so the surplus is dropped rather than compressed
 * into a burst.
 */
export const MAX_CHATTER_TICKS_PER_FRAME = 5;

/**
 * The answers to this frame's orders: one "ok" per ordered settler that has a voice, panned by where it
 * stands but neither culled nor attenuated, so a settler ordered off screen still answers. Keyed by pool,
 * so two settlers sharing a voice inside the engine's cooldown collapse into one line, and exclusive by
 * pool: the original answers nothing while any line of that settler's pool is still sounding.
 */
export function responseShots(input: DirectorInput): OneShot[] {
  const { responses, snapshot, index, camera, canvasW } = input;
  if (responses === undefined || responses.length === 0) return [];
  const shots: OneShot[] = [];
  for (const id of responses) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    const group = responseGroup(index, e);
    const files = group === undefined ? undefined : groupFiles(index, group);
    if (files === undefined) continue;
    const tile = entityTile(e.components);
    shots.push({
      files,
      gain: SFX_GAIN,
      pan: tile === null ? 0 : computePan(tile.col, tile.row, camera, canvasW),
      key: `respond:${group}`,
      exclusive: 'group',
    });
  }
  return shots;
}

/** One drawn creature that may speak, placed. */
interface Speaker {
  readonly id: number;
  readonly tile: TilePoint;
}

/** The drawn creatures by what they speak with: people by their tribe-and-class voice row in the order the
 *  original polls them (tribe, then child / female / male), animals by tribe. */
interface Speakers {
  readonly pools: readonly (readonly [HumanVoices, readonly Speaker[]])[];
  readonly herds: ReadonlyMap<number, readonly Speaker[]>;
}

function addTo<K>(groups: Map<K, Speaker[]>, key: K, speaker: Speaker): void {
  const group = groups.get(key);
  if (group === undefined) groups.set(key, [speaker]);
  else group.push(speaker);
}

/**
 * The drawn creatures that may speak: the local player's own people with a chatter pool (the original
 * searches its own humans' sector lists) and every animal of a calling tribe. A creature without a
 * position cannot be placed and is left out.
 */
function speakers(
  snapshot: WorldSnapshot,
  index: SoundIndex,
  drawn: Iterable<number>,
  localPlayer: number | undefined,
): Speakers {
  const pools = new Map<HumanVoices, Speaker[]>();
  const herds = new Map<number, Speaker[]>();
  for (const id of drawn) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    const tribe = creatureTribe(e.components);
    const tile = entityTile(e.components);
    if (tribe === undefined || tile === null) continue;
    if (isPerson(e.components)) {
      if (localPlayer === undefined || entityOwner(e.components) !== localPlayer) continue;
      const voices = humanVoicesOf(index, e);
      if (voices?.generic !== undefined) addTo(pools, voices, { id, tile });
    } else if (index.animalCalls.has(tribe)) {
      addTo(herds, tribe, { id, tile });
    }
  }
  const pollOrder = (v: HumanVoices): number =>
    v.tribe * VOICE_CLASSES.length + VOICE_CLASSES.indexOf(v.voiceClass);
  return { pools: [...pools.entries()].sort(([a], [b]) => pollOrder(a) - pollOrder(b)), herds };
}

/** A positioned, self-exclusive one-shot at a speaker, or null when it stands off screen or in the fog. */
function speakerShot(
  input: DirectorInput,
  speaker: Speaker,
  files: readonly string[],
  key: string,
): OneShot | null {
  const { camera, canvasW, canvasH, visibleTile } = input;
  if (visibleTile !== undefined && !visibleTile(speaker.tile.col, speaker.tile.row)) return null;
  const spatial = computeSpatial(speaker.tile.col, speaker.tile.row, camera, canvasW, canvasH);
  if (spatial === null) return null;
  return { files, gain: spatial.gain * SFX_GAIN, pan: spatial.pan, key, exclusive: 'wav' };
}

/** One of a group, picked by the roll source. */
function pickOne(members: readonly Speaker[], random: () => number): Speaker | undefined {
  return members[Math.floor(random() * members.length)];
}

/**
 * One game tick's roll of the idle human voices: one die against every tribe-and-class pool's head count
 * in poll order, and the first pool the die lands under speaks through one of its people, picked at
 * random (approximation: the original takes the first of them its sector scan meets). At most one line a
 * tick, and a crowd of many pools is no chattier than its largest pool.
 */
function genericRoll(input: DirectorInput, chatter: ChatterInput, pools: Speakers['pools']): OneShot | null {
  const die = Math.floor(chatter.random() * GENERIC_ROLL_RANGE);
  for (const [voices, members] of pools) {
    if (die >= members.length) continue;
    const files = voices.generic === undefined ? undefined : groupFiles(input.index, voices.generic);
    const speaker = pickOne(members, chatter.random);
    if (files === undefined || speaker === undefined) continue;
    return speakerShot(input, speaker, files, `generic:${voices.generic}`);
  }
  return null;
}

/**
 * One game tick's roll of the animal calls: each drawn animal tribe with at least its `minCount` on screen
 * rolls its `probability` in {@link ANIMAL_ROLL_RANGE} (inclusive, as the original compares), and a winner
 * calls through one of its animals picked at random.
 */
function animalRoll(input: DirectorInput, chatter: ChatterInput, herds: Speakers['herds']): OneShot[] {
  const shots: OneShot[] = [];
  for (const [tribe, herd] of herds) {
    const call = input.index.animalCalls.get(tribe);
    if (call === undefined || herd.length < call.minCount) continue;
    if (Math.floor(chatter.random() * ANIMAL_ROLL_RANGE) > call.probability) continue;
    const files = groupFiles(input.index, call.group);
    const caller = pickOne(herd, chatter.random);
    if (files === undefined || caller === undefined) continue;
    const shot = speakerShot(input, caller, files, `animal:${call.group}`);
    if (shot !== null) shots.push(shot);
  }
  return shots;
}

/** The unprompted voices this frame: the human natter and animal calls of the drawn creatures, rolled once
 *  per game tick the frame advanced (capped at {@link MAX_CHATTER_TICKS_PER_FRAME}). */
export function chatterShots(input: DirectorInput): OneShot[] {
  const chatter = input.chatter;
  if (chatter === undefined || chatter.ticks <= 0) return [];
  const ticks = Math.min(chatter.ticks, MAX_CHATTER_TICKS_PER_FRAME);
  const { pools, herds } = speakers(input.snapshot, input.index, chatter.drawn(), input.localPlayer);
  if (pools.length === 0 && herds.size === 0) return [];
  const shots: OneShot[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const line = genericRoll(input, chatter, pools);
    if (line !== null) shots.push(line);
    shots.push(...animalRoll(input, chatter, herds));
  }
  return shots;
}
