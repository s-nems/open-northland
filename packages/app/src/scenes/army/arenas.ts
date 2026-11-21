import { type Command, cellAnchorNode, type Simulation, systems } from '@open-northland/sim';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import { goodBySlug } from '../sandbox-queries.js';

// Squads for the trial scenes: small fights laid out on open ground, spawned as setup commands.

export type ArmourSlug = 'armor_wool' | 'armor_leather' | 'armor_chain' | 'armor_plate';

/** `count` men of one trade in one armour, `points` of fight experience each. */
export interface Squad {
  readonly job: number;
  readonly count: number;
  readonly armour: ArmourSlug | null;
  readonly points: number;
}

export const squad = (job: number, count: number, armour: ArmourSlug | null, points = 0): Squad => ({
  job,
  count,
  armour,
  points,
});

export const headcount = (squads: readonly Squad[]): number => squads.reduce((n, s) => n + s.count, 0);

/** How a squad stands: columns of `fileSize` men, files `fileStep` nodes apart, each column `columnStep`
 *  nodes behind the last. */
export interface Formation {
  readonly fileSize: number;
  readonly fileStep: number;
  readonly columnStep: number;
}

/** Where a squad stands: its front column at `frontHx`, centred on `centreHy`, its columns deepening
 *  along `away` (-1 west, 1 east), away from the enemy. */
export interface SquadPlace {
  readonly frontHx: number;
  readonly centreHy: number;
  readonly away: -1 | 1;
}

/** The node nearest (hx, hy) that anchors a cell, the only nodes a building or vehicle stands on. */
export function anchorNear(hx: number, hy: number): { hx: number; hy: number } {
  return cellAnchorNode(Math.floor(hx / 2), Math.floor(hy / 2));
}

/** One `spawnSettler` per man of `squads`, filling the formation's columns in squad order. */
export function spawnSquads(
  sim: Simulation,
  squads: readonly Squad[],
  place: SquadPlace,
  owner: number,
  formation: Formation,
): Command[] {
  const { fileSize, fileStep, columnStep } = formation;
  const commands: Command[] = [];
  let slot = 0;
  for (const s of squads) {
    for (let i = 0; i < s.count; i++, slot++) {
      const column = Math.floor(slot / fileSize);
      const file = slot % fileSize;
      // Every other column stands half a file over, so the ranks read as loose rather than a grid.
      const hy = place.centreHy + (file - (fileSize - 1) / 2) * fileStep + (column % 2) * (fileStep / 2);
      commands.push(fighter(sim, s, place.frontHx + place.away * column * columnStep, hy, owner));
    }
  }
  return commands;
}

function fighter(sim: Simulation, s: Squad, hx: number, hy: number, owner: number): Command {
  return {
    kind: 'spawnSettler',
    jobType: s.job,
    x: hx,
    y: hy,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(s.armour === null ? {} : { equipment: { armor: { goodType: goodBySlug(sim, s.armour) } } }),
    ...(s.points > 0
      ? {
          experience: [
            [systems.FIGHT_EXPERIENCE_TYPE.PERSONAL, systems.fightUnitsOfPoints(s.points)] as const,
          ],
        }
      : {}),
  };
}
