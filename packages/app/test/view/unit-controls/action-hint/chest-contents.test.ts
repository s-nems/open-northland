import {
  components,
  type HalfCellNode,
  hexDistanceBetween,
  hexNeighboursOf,
  type MissionDefinition,
  type MissionResultOp,
  type MissionScript,
  positionOfNode,
  SUCCESSFUL_IF,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { seatNumber } from '../../../../src/game/match/seat-names.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import { jobDisplayName } from '../../../../src/hud/details-panel/model/context.js';
import { goodName, messages } from '../../../../src/i18n/index.js';
import { chestContentsLabel } from '../../../../src/view/unit-controls/action-hint/chest-contents.js';

const CONTENT = sandboxContent();
/** The chest type holding simple food, a bulk row counted per chest kind. */
const FOOD_CHEST = 20;
/** The chest type a placement without a level authors, which the table does not name. */
const SCRIPTED_CHEST = 0;
const CHEST_NODE: HalfCellNode = { hx: 40, hy: 20 };
const FAR_NODE: HalfCellNode = { hx: 80, hy: 60 };
const TRIGGER_RANGE = 1;
const CIVILIST = CONTENT.jobs.find((job) => job.id === 'civilist')?.typeId ?? -1;
const SPAWNED = 3;
const FIRST_SEAT = 2;
const SECOND_SEAT = 3;
const NEXT_MISSION = 1;
const { NEEDS_FROZEN, GLOWS } = components.MISSION_BEHAVIOUR;

function chest(kind: 'wooden' | 'magical', contents: number, node = CHEST_NODE) {
  const p = positionOfNode(node.hx, node.hy);
  return { id: 1, components: { Chest: { kind, contents }, Position: { x: p.x, y: p.y } } };
}

function mission(
  results: readonly MissionResultOp[],
  successfullIf: number = SUCCESSFUL_IF.none,
): MissionDefinition {
  return {
    successfullIf,
    active: true,
    visible: false,
    goals: [{ opcode: 'ChestNearPos', point: CHEST_NODE, range: TRIGGER_RANGE }],
    results,
  };
}

function naming(missions: readonly MissionDefinition[] | undefined) {
  const script: MissionScript | undefined = missions === undefined ? undefined : { missions };
  return {
    content: CONTENT,
    uiString: (_table: string, _id: number, fallback: string) => fallback,
    buildingLabel: () => undefined,
    missions: script,
    seatName: () => undefined,
  };
}

const NEXT: MissionResultOp = { opcode: 'ActivateMission', missionIndex: NEXT_MISSION };

describe('the chest contents label', () => {
  it("counts the goods by the chest's kind and names nothing for a type the table lacks", () => {
    const food = CONTENT.goods.find((good) => good.id === 'food_simple');
    expect(food).toBeDefined();
    const name = food === undefined ? '' : goodName(food);
    expect(chestContentsLabel(naming(undefined), chest('wooden', FOOD_CHEST))).toBe(`${name} ×30`);
    expect(chestContentsLabel(naming(undefined), chest('magical', FOOD_CHEST))).toBe(`${name} ×48`);
    expect(chestContentsLabel(naming(undefined), chest('wooden', SCRIPTED_CHEST))).toBeNull();
  });

  it('tells what the map script fires once the chest in reach of its goal opens', () => {
    const behaviour = (player: number): MissionResultOp => ({
      opcode: 'SetPlayerBehaviourFlag',
      player,
      amount: NEEDS_FROZEN | GLOWS,
      flag: true,
    });
    const spawn: MissionResultOp = {
      opcode: 'SetHuman',
      player: FIRST_SEAT,
      tribe: 0,
      job: CIVILIST,
      point: CHEST_NODE,
      humanId: 0,
      behaviour: 0,
    };
    const script = [
      mission([
        behaviour(SECOND_SEAT),
        behaviour(FIRST_SEAT),
        ...Array.from({ length: SPAWNED }, () => spawn),
        NEXT,
      ]),
    ];
    const words = messages().hud.chestScript;
    const seats = [FIRST_SEAT, SECOND_SEAT]
      .map((seat) => `${messages().hud.player} ${seatNumber(seat)}`)
      .join(', ');
    expect(chestContentsLabel(naming(script), chest('wooden', SCRIPTED_CHEST))).toBe(
      `${seats}: ${words.needsFrozen} · ${jobDisplayName(CONTENT, CIVILIST)} ×${SPAWNED}`,
    );
    const edge = hexNeighboursOf(CHEST_NODE.hx, CHEST_NODE.hy)[0] ?? CHEST_NODE;
    expect(hexDistanceBetween(edge.hx, edge.hy, CHEST_NODE.hx, CHEST_NODE.hy)).toBe(TRIGGER_RANGE);
    expect(chestContentsLabel(naming([mission([NEXT])]), chest('wooden', SCRIPTED_CHEST, edge))).toBe(
      words.script,
    );
    expect(chestContentsLabel(naming(script), chest('wooden', SCRIPTED_CHEST, FAR_NODE))).toBeNull();
    // A mission that holds while the chest still stands is no reward for opening it.
    const whileClosed = [mission([NEXT], SUCCESSFUL_IF.all)];
    expect(chestContentsLabel(naming(whileClosed), chest('wooden', SCRIPTED_CHEST))).toBeNull();
  });
});
