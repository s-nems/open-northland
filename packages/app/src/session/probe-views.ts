import {
  type MooringAnswer,
  type MooringProbe,
  type NodeArea,
  type NodeGridAnswer,
  type NodeSetAnswer,
  nodeGridAccepts,
  nodeSetHas,
} from '@open-northland/sim';
import type { LastAnswerCache } from './last-answer-cache.js';

/** Edge in half-cell nodes of the square areas a grid probe is asked over: a screen spans a handful of
 *  them and a pan asks only for the ones it uncovers, so the sim never evaluates the whole map. */
export const PROBE_AREA_NODES = 32;

/** A host grid probe read synchronously. `undefined` while the node's area is still being answered;
 *  `null` when the host has no such probe, as a mapless world has none. */
export interface NodeGridProbe {
  answerAt(hx: number, hy: number): NodeGridAnswer | null | undefined;
  at(hx: number, hy: number): boolean | null | undefined;
  /** The verdict at a node as of now, for a click: asks the host unless its answer is current. */
  freshAt(hx: number, hy: number): Promise<boolean | null>;
  /** The answers' keys over a node box, so a memo over the box re-walks once one of them changes or
   *  lands; null while none has landed or when the host has no such probe. */
  keyWithin(minHx: number, maxHx: number, minHy: number, maxHy: number): string | null;
}

/** The mark {@link NodeGridProbe.keyWithin} writes for an area still being answered. */
const PENDING_AREA_KEY = '?';

/**
 * A {@link NodeGridProbe} over `cache`, asking `ask` per {@link PROBE_AREA_NODES} area. `family` names
 * the probe and its arguments within the cache; `inputs` is the host's version of what the answers read,
 * and `perTick` asks again every tick for what no version names.
 */
export function nodeGridProbe(
  cache: LastAnswerCache<NodeGridAnswer | null>,
  family: string,
  ask: (area: NodeArea) => Promise<NodeGridAnswer | null>,
  inputs: () => string,
  perTick = false,
): NodeGridProbe {
  const keyOf = (ax: number, ay: number): string => `${family}@${ax},${ay}`;
  const answerOfArea = (ax: number, ay: number, stamp: string): NodeGridAnswer | null | undefined =>
    cache.read(keyOf(ax, ay), () => ask(probeArea(ax, ay)), stamp, perTick);
  const answerAt = (hx: number, hy: number): NodeGridAnswer | null | undefined =>
    answerOfArea(areaIndex(hx), areaIndex(hy), inputs());
  return {
    answerAt,
    at: (hx, hy) => {
      const answer = answerAt(hx, hy);
      return answer === undefined || answer === null ? answer : nodeGridAccepts(answer, hx, hy);
    },
    freshAt: (hx, hy) => {
      const ax = areaIndex(hx);
      const ay = areaIndex(hy);
      return cache
        .fresh(keyOf(ax, ay), () => ask(probeArea(ax, ay)), inputs(), perTick)
        .then((answer) => (answer === null ? null : nodeGridAccepts(answer, hx, hy)));
    },
    keyWithin: (minHx, maxHx, minHy, maxHy) => {
      // The inputs are one version string for the whole box, read once rather than per area.
      const stamp = inputs();
      const parts: string[] = [];
      let landed = false;
      for (let ay = areaIndex(minHy); ay <= areaIndex(maxHy); ay++) {
        for (let ax = areaIndex(minHx); ax <= areaIndex(maxHx); ax++) {
          const answer = answerOfArea(ax, ay, stamp);
          if (answer === null) return null;
          landed ||= answer !== undefined;
          parts.push(answer === undefined ? PENDING_AREA_KEY : answer.key);
        }
      }
      return landed ? parts.join(';') : null;
    },
  };
}

function areaIndex(node: number): number {
  return Math.floor(node / PROBE_AREA_NODES);
}

function probeArea(ax: number, ay: number): NodeArea {
  const minHx = ax * PROBE_AREA_NODES;
  const minHy = ay * PROBE_AREA_NODES;
  return { minHx, minHy, maxHx: minHx + PROBE_AREA_NODES - 1, maxHy: minHy + PROBE_AREA_NODES - 1 };
}

/** Grid answers with the same key say the same thing. */
export function sameGridAnswer(held: NodeGridAnswer | null, landed: NodeGridAnswer | null): boolean {
  return held === null || landed === null ? held === landed : held.key === landed.key;
}

/** The mooring probe over its received answer. */
export function mooringProbeOf(answer: MooringAnswer): MooringProbe {
  return { key: answer.key, canMoor: (x, y) => nodeSetHas(answer.spots, x, y) };
}

/** Two node sets holding the same nodes. */
export function sameNodeSet(held: NodeSetAnswer, landed: NodeSetAnswer): boolean {
  return held.length === landed.length && held.every((node, index) => node === landed[index]);
}

/** Mooring answers with the same key moor at the same spots. */
export function sameMooring(held: MooringProbe | null, landed: MooringProbe | null): boolean {
  return held === null || landed === null ? held === landed : held.key === landed.key;
}
