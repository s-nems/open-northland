import type { ContentSet } from '@open-northland/data';
import {
  components,
  type HalfCellNode,
  hexDistanceBetween,
  type MissionResultOp,
  type MissionScript,
  SUCCESSFUL_IF,
} from '@open-northland/sim';
import type { UiString } from '../../../content/gui/gfx.js';
import { vehicleLabel } from '../../../game/technology.js';
import { jobDisplayName } from '../../../hud/details-panel/model/context.js';
import { playerLabel } from '../../../hud/dom/diplomacy-window/model.js';
import { type Messages, messages } from '../../../i18n/index.js';
import { countedLabel, goodLabel } from './counted-label.js';

/** A mission a chest's opening fires: it holds once no closed chest stands within `range` of `point`. */
interface ChestTrigger {
  readonly point: HalfCellNode;
  readonly range: number;
  readonly results: readonly MissionResultOp[];
}

type BehaviourWord = Exclude<keyof Messages['hud']['chestScript'], 'script'>;

/** The human behaviour bits a chest script hands out that change play, in the order the line names them;
 *  a bit only drawn (the glow, the import marker) goes unnamed. */
const BEHAVIOUR_WORDS: readonly (readonly [number, BehaviourWord])[] = [
  [components.MISSION_BEHAVIOUR.NEEDS_FROZEN, 'needsFrozen'],
  [components.MISSION_BEHAVIOUR.WALKS_FAST, 'walksFast'],
];

const triggersByScript = new WeakMap<MissionScript, readonly ChestTrigger[]>();

function chestTriggers(script: MissionScript): readonly ChestTrigger[] {
  let found = triggersByScript.get(script);
  if (found === undefined) {
    const list: ChestTrigger[] = [];
    for (const mission of script.missions) {
      if (mission.successfullIf !== SUCCESSFUL_IF.none) continue;
      for (const goal of mission.goals) {
        if (goal.opcode === 'ChestNearPos' && goal.range >= 0)
          list.push({ point: goal.point, range: goal.range, results: mission.results });
      }
    }
    found = list;
    triggersByScript.set(script, found);
  }
  return found;
}

function add(counts: Map<number, number>, key: number, amount: number): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

function behaviourWords(mask: number): string | null {
  const words = messages().hud.chestScript;
  const named = BEHAVIOUR_WORDS.filter(([bit]) => (mask & bit) !== 0).map(([, word]) => words[word]);
  return named.length === 0 ? null : named.join(', ');
}

export interface ChestScriptNaming {
  readonly content: ContentSet;
  readonly uiString: UiString;
  readonly missions: MissionScript | undefined;
  readonly seatName: (player: number) => string | undefined;
}

/**
 * What the map script does once the chest at `node` opens, as label parts: the behaviour a seat's people
 * get, the people and vehicles that stand up, the goods handed over. A chest whose missions do only what
 * the line does not name (a film, the next mission) reads as the map script; an empty list means no
 * mission waits on the chest.
 */
export function chestScriptParts(naming: ChestScriptNaming, node: HalfCellNode): readonly string[] {
  if (naming.missions === undefined) return [];
  const { content } = naming;
  const behaviours = new Map<string, Set<number>>();
  const people = new Map<number, number>();
  const goods = new Map<number, number>();
  const vehicles = new Map<number, number>();
  let triggered = false;
  for (const trigger of chestTriggers(naming.missions)) {
    if (hexDistanceBetween(node.hx, node.hy, trigger.point.hx, trigger.point.hy) > trigger.range) continue;
    triggered = true;
    for (const result of trigger.results) {
      switch (result.opcode) {
        case 'SetPlayerBehaviourFlag':
          if (result.flag) {
            // Keyed by the words, so two masks differing only in unnamed bits read as one line.
            const words = behaviourWords(result.amount);
            if (words === null) break;
            const players = behaviours.get(words) ?? new Set<number>();
            players.add(result.player);
            behaviours.set(words, players);
          }
          break;
        case 'SetHuman':
          add(people, result.job, 1);
          break;
        case 'SetHumanX':
          add(people, result.job, result.amount);
          break;
        case 'SetVehicle':
          add(vehicles, result.vehicleType, 1);
          break;
        case 'AddGoodsToAnyStock':
        case 'AddGoodsToHouses':
          add(goods, result.good, result.amount);
          break;
        default:
          break;
      }
    }
  }
  if (!triggered) return [];
  const parts: string[] = [];
  for (const [words, players] of behaviours) {
    const names = [...players]
      .sort((a, b) => a - b)
      .map((player) => playerLabel(naming.uiString, player, naming.seatName(player)));
    parts.push(`${names.join(', ')}: ${words}`);
  }
  for (const [jobType, count] of people) parts.push(countedLabel(jobDisplayName(content, jobType), count));
  for (const [goodType, amount] of goods) parts.push(countedLabel(goodLabel(content, goodType), amount));
  for (const [vehicleType, count] of vehicles)
    parts.push(countedLabel(vehicleLabel(content, vehicleType) ?? `#${vehicleType}`, count));
  return parts.length === 0 ? [messages().hud.chestScript.script] : parts;
}
