import { type EntitySnapshot, entityById } from '@open-northland/sim';
import { groupFiles, poolGain, type SoundIndex } from '../bank.js';
import { clamp } from '../math.js';
import { ANSWER_MUSIC_DUCK_DB } from '../mixer.js';
import { entityTile } from '../snapshot.js';
import { screenOffset } from '../spatial.js';
import type { DirectorInput, OneShot, OrderAnswer, VoiceCall } from '../types.js';
import { uiCueShot } from '../ui-cues.js';
import { murmurPool, refusalGroup, responseGroup, selectLine } from '../voices.js';

/**
 * How a group answers the player: one lead line from the member nearest the screen centre, panned at
 * the group's screen centroid, and for a larger group a few more lines from other actors of the
 * members' own tribes and a murmur bed. The original lets every
 * selected settler answer, so a group sounds one line per distinct pool at once; this keeps that
 * sound of many voices while bounding it. Every count, delay, level and spread here is an
 * approximation to tune by ear.
 */

/** One extra line under the lead: when it starts after the lead, how far below it, how far off its pan. */
export interface AnswerLayer {
  readonly delayS: number;
  readonly gainDb: number;
  readonly panOffset: number;
}

/** The layers a group may add under its lead, in the order they are used. Each enters after the lead's
 *  first syllable and well under it, so the lead's onset stays clear and the rest reads as more voices. */
export const ANSWER_LAYERS: readonly AnswerLayer[] = [
  { delayS: 0.15, gainDb: -9, panOffset: -0.2 },
  { delayS: 0.28, gainDb: -11, panOffset: 0.2 },
  { delayS: 0.42, gainDb: -13, panOffset: -0.1 },
];

/** The widest pan of an answer or a selection line: feedback to the player's own click stays near the
 *  centre, a group at the screen edge or beyond only leaning to its side. */
export const ANSWER_MAX_PAN = 0.35;

/** The group sizes at which each further layer joins: one at 1-4 speakers, two at 5-19, three from
 *  20. A layer still needs a member of another pool than the lines already chosen. */
export const LAYER_GROUP_SIZES: readonly number[] = [1, 5, 20];

/** Speakers a group needs before its answer lays a murmur bed under the lines. */
export const MURMUR_MIN_GROUP = 50;
/** The murmur bed's lines: when each starts and how far off the group's pan it sits. They spread over
 *  about a second and a half, so the bed swells after the answer rather than with it. */
export const MURMUR_LINES: readonly Omit<AnswerLayer, 'gainDb'>[] = [
  { delayS: 0.15, panOffset: -0.35 },
  { delayS: 0.6, panOffset: 0.35 },
  { delayS: 1.05, panOffset: 0 },
];
/** The murmur's level below its pools' own authored volume, in dB. */
export const MURMUR_GAIN_DB = -6;
/** Seconds before another order may lay a murmur bed, so rapid orders do not pile beds up. */
export const MURMUR_COOLDOWN_S = 2;

/** Seconds before one settler answers being selected again. */
export const SELECT_COOLDOWN_S = 1.5;

function dbGain(db: number): number {
  return 10 ** (db / 20);
}

function clampPan(pan: number): number {
  return clamp(pan, -ANSWER_MAX_PAN, ANSWER_MAX_PAN);
}

/** One addressed person and how far from the screen centre it stands, in half-screen units. */
interface Member {
  readonly entity: EntitySnapshot;
  readonly offsetX: number | null;
  readonly distance: number;
}

/** The addressed members still in the snapshot, placed against the screen centre. */
function placeMembers(input: DirectorInput, ids: Iterable<number>): Member[] {
  const members: Member[] = [];
  for (const id of ids) {
    const entity = entityById(input.snapshot, id);
    if (entity === undefined) continue;
    const tile = entityTile(entity.components);
    const offset =
      tile === null ? null : screenOffset(tile.col, tile.row, input.camera, input.canvasW, input.canvasH);
    members.push({
      entity,
      offsetX: offset?.nx ?? null,
      distance: offset === null ? Number.POSITIVE_INFINITY : Math.hypot(offset.nx, offset.ny),
    });
  }
  return members;
}

/** The pan at the members' mean screen position, scaled into {@link ANSWER_MAX_PAN} and held at it for a
 *  group off screen, with no cull and no attenuation: the original pans an order's answer by position,
 *  its volume whole and with no screen or fog test. The narrow width is our choice. */
function centroidPan(members: readonly Member[]): number {
  let sum = 0;
  let placed = 0;
  for (const m of members) {
    if (m.offsetX === null) continue;
    sum += m.offsetX;
    placed++;
  }
  return placed === 0 ? 0 : clamp(sum / placed, -1, 1) * ANSWER_MAX_PAN;
}

/** A member and the pool it speaks for the group with. */
interface Speaker {
  readonly member: Member;
  readonly group: string;
  readonly files: readonly string[];
}

/** Each pool's speaker nearest the screen centre, nearest pools first, and how many members speak. */
function speakersByPool(
  index: SoundIndex,
  members: readonly Member[],
  poolOf: (index: SoundIndex, e: EntitySnapshot) => string | undefined,
): { readonly nearest: readonly Speaker[]; readonly count: number } {
  const byPool = new Map<string, Speaker>();
  let count = 0;
  for (const member of members) {
    const group = poolOf(index, member.entity);
    const files = group === undefined ? undefined : groupFiles(index, group);
    if (group === undefined || files === undefined) continue;
    count++;
    const held = byPool.get(group);
    if (held === undefined || member.distance < held.member.distance)
      byPool.set(group, { member, group, files });
  }
  const nearest = [...byPool.values()].sort((a, b) => a.member.distance - b.member.distance);
  return { nearest, count };
}

/** How many layers a group of `speakers` adds under its lead. */
export function layerCount(speakers: number): number {
  return LAYER_GROUP_SIZES.filter((size) => speakers >= size).length;
}

/**
 * One order's answer. An order every member refused is answered "no" by the lead alone. An accepted one
 * is answered "ok" by the lead at its pool's level and the group's pan, then by up to
 * {@link layerCount} other pools' nearest speakers, each quieter, later and a little off to one side,
 * and a group of {@link MURMUR_MIN_GROUP} lays its tribes' murmur under them. Every line is exclusive
 * by pool, so a pool still answering an earlier order stays out. With no member to speak, the call's fallback cue plays instead.
 */
export function groupAnswerShots(input: DirectorInput, answer: OrderAnswer): OneShot[] {
  const members = placeMembers(input, answer.members);
  const pan = centroidPan(members);
  const fallback = answer.fallback === undefined ? [] : [uiCueShot(answer.fallback)];
  if (answer.refused === true) {
    const lead = speakersByPool(input.index, members, refusalGroup).nearest[0];
    if (lead === undefined) return fallback;
    return [answerShot(input.index, lead, `refuse:${lead.group}`, pan)];
  }
  const { nearest, count } = speakersByPool(input.index, members, responseGroup);
  const lead = nearest[0];
  if (lead === undefined) return fallback;
  const shots = [answerShot(input.index, lead, `respond:${lead.group}`, pan)];
  const layers = nearest.slice(1, 1 + Math.min(layerCount(count), ANSWER_LAYERS.length));
  layers.forEach((speaker, i) => {
    const layer = ANSWER_LAYERS[i];
    if (layer === undefined) return;
    const shot = answerShot(
      input.index,
      speaker,
      `respond:${speaker.group}`,
      clampPan(pan + layer.panOffset),
    );
    shots.push({ ...shot, gain: shot.gain * dbGain(layer.gainDb), delayS: layer.delayS });
  });
  if (count >= MURMUR_MIN_GROUP) shots.push(...murmurShots(input.index, members, pan));
  return shots;
}

function answerShot(index: SoundIndex, speaker: Speaker, key: string, pan: number): OneShot {
  return {
    files: speaker.files,
    gain: poolGain(index, speaker.files),
    pan,
    key,
    exclusive: 'group',
    duckMusicDb: ANSWER_MUSIC_DUCK_DB,
  };
}

/** The murmur bed's lines, cycling through the members' murmur pools from the most spoken. */
function murmurShots(index: SoundIndex, members: readonly Member[], pan: number): OneShot[] {
  const counts = new Map<readonly string[], number>();
  for (const m of members) {
    const pool = murmurPool(index, m.entity);
    if (pool !== undefined) counts.set(pool, (counts.get(pool) ?? 0) + 1);
  }
  const pools = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([pool]) => pool);
  if (pools.length === 0) return [];
  return MURMUR_LINES.flatMap((line, i) => {
    const files = pools[i % pools.length];
    if (files === undefined) return [];
    return [
      {
        files,
        gain: poolGain(index, files) * dbGain(MURMUR_GAIN_DB),
        pan: clampPan(pan + line.panOffset),
        key: `murmur:${i}`,
        exclusive: 'wav' as const,
        delayS: line.delayS,
        cooldownS: MURMUR_COOLDOWN_S,
      },
    ];
  });
}

/**
 * A selection's acknowledgement: the shortest "ok" line of the member nearest the screen centre, at its
 * pool's level and the selection's pan, at most once per {@link SELECT_COOLDOWN_S} for that settler, and
 * never while any line of its pool still sounds. An order's answer over the same pool cuts it short. The original selects in silence; this is our choice. With no member to speak, the call's fallback
 * cue plays instead.
 */
export function selectionShots(input: DirectorInput, call: VoiceCall): OneShot[] {
  const members = placeMembers(input, call.members);
  const lead = speakersByPool(input.index, members, responseGroup).nearest[0];
  const line = lead === undefined ? undefined : selectLine(input.index, lead.group, input.clipLengthS);
  if (lead === undefined || line === undefined) {
    return call.fallback === undefined ? [] : [uiCueShot(call.fallback)];
  }
  return [
    {
      files: [line],
      poolFiles: lead.files,
      gain: poolGain(input.index, lead.files),
      pan: centroidPan(members),
      key: `select:${lead.member.entity.id}`,
      exclusive: 'group',
      yieldsToAnswer: true,
      cooldownS: SELECT_COOLDOWN_S,
    },
  ];
}
