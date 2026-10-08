import type { SoundBank } from '@open-northland/data';
import { type Camera, tileToScreen } from '@open-northland/render/data';
import {
  type Entity,
  type EntitySnapshot,
  type HalfCellNode,
  ONE,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  buildSoundIndex,
  defaultBindings,
  directAudio,
  type OneShot,
  type OrderAnswer,
  type SoundIndex,
} from '../../src/index.js';

/**
 * A fixture battle the director turns into the shots it really emits: viking men and women trading sword
 * blows around the screen centre. Pools carry the real bank's sizes (`Man Get Hit` 10 wavs, `Woman Get
 * Hit` 8, the short-sword swing 5), so the arbiter is tested on the shapes it meets in play.
 */

const VIKING = 1;
/** The short sword's listed impact (`soundtype_Hit`), as the weapon tables name it. */
export const SWORD_HIT_SOUND = 82;

function pool(prefix: string, count: number): { file: string; params: number[] }[] {
  return Array.from({ length: count }, (_, i) => ({ file: `${prefix}${i + 1}.wav`, params: [80] }));
}

const bank: SoundBank = {
  staticGroups: [
    { name: 'Weapon Sword Short', sfx: pool('static/swing', 5) },
    { name: 'Weapon Sword Short Hit', logicSoundType: SWORD_HIT_SOUND, sfx: pool('static/swordhit', 4) },
    { name: 'Man Get Hit', sfx: pool('static/hit m ', 10) },
    { name: 'Woman Get Hit', sfx: pool('static/hit f ', 8) },
    { name: 'Generic Viking Male', sfx: pool('generic/m ', 6) },
    { name: 'Viking male ok 01', sfx: pool('humantalk/m1ok', 3) },
  ],
  ambient: [],
  jingles: [],
  humanVoices: [
    {
      tribe: VIKING,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Generic Viking Male',
      respondOk: ['Viking male ok 01'],
      respondNo: [],
    },
    { tribe: VIKING, voiceClass: 'female', scream: 'Woman Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [],
};

export const battleIndex: SoundIndex = buildSoundIndex(bank, [], []);

const CANVAS_W = 800;
const CANVAS_H = 600;
const CENTRE_COL = 5;
const CENTRE_ROW = 5;
/** Half-cell node of the centre tile, and how far around it the fighters stand (all on screen). */
const CENTRE_NODE: HalfCellNode = { hx: 2 * CENTRE_COL + 1, hy: 2 * CENTRE_ROW };
const SPREAD_NODES = 8;
const centre = tileToScreen(CENTRE_COL, CENTRE_ROW);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };

/** Where fighter `id` stands: a node near the centre, spread so pairs land on distinct spots. */
function nodeOf(id: number): HalfCellNode {
  const side = 2 * SPREAD_NODES + 1;
  return {
    hx: CENTRE_NODE.hx - SPREAD_NODES + (id % side),
    hy: CENTRE_NODE.hy - SPREAD_NODES + (Math.floor(id / side) % side),
  };
}

function fighter(id: number): EntitySnapshot {
  const at = nodeOf(id);
  const female = id % 2 === 1;
  return {
    id,
    components: {
      Position: { x: Math.floor(at.hx / 2) * ONE, y: Math.floor(at.hy / 2) * ONE },
      Settler: { tribe: VIKING },
      Person: { person: true },
      Owner: { player: 0 },
      ...(female ? { Female: { female: true } } : {}),
    },
  };
}

export function battleSnapshot(units: number): WorldSnapshot {
  return { tick: 1, entities: Array.from({ length: units }, (_, i) => fighter(i + 1)), events: [] };
}

/** One frame of a melee: every fighter swings, and lands a blow on the next one. */
export function battleEvents(units: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let id = 1; id <= units; id++) {
    const target = (id % units) + 1;
    events.push({ kind: 'combatSwing', attacker: id as Entity, at: nodeOf(id) });
    events.push({
      kind: 'combatHit',
      attacker: id as Entity,
      target: target as Entity,
      soundType: SWORD_HIT_SOUND,
      at: nodeOf(target),
    });
  }
  return events;
}

/** What the director decides for a battle frame: swings, body blows, screams, and optionally the idle
 *  chatter of the fighters on screen and the answers of settlers just ordered. */
export function battleShots(
  snapshot: WorldSnapshot,
  events: readonly SimEvent[],
  extra: { readonly chatterTicks?: number; readonly responses?: readonly OrderAnswer[] } = {},
): OneShot[] {
  return [
    ...directAudio({
      events,
      snapshot,
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index: battleIndex,
      bindings: defaultBindings(),
      localPlayer: 0,
      ...(extra.responses !== undefined ? { responses: extra.responses } : {}),
      ...(extra.chatterTicks !== undefined
        ? {
            chatter: {
              drawn: () => snapshot.entities.map((e) => e.id),
              ticks: extra.chatterTicks,
              random: () => 0,
            },
          }
        : {}),
    }).oneShots,
  ];
}
