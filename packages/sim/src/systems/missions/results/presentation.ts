import { nameHuman, retainMissionBriefing, setMissionBriefingPage } from '../../../components/index.js';
import { retainMissionPresentation } from '../../../components/mission-presentation.js';
import type { SimEvent } from '../../../core/events.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHumans } from '../targets.js';

/** The GUI marker slots the original keeps (reading). */
const GUI_MARKER_SLOTS = 10;
/** A weather square is clamped to this density (reading); the script writes it in hundredths. */
const WEATHER_DENSITY_SCALE = 100;
const WEATHER_DENSITY_MAX = 10000;

/** Open the briefing page and end the pass after this mission; with the replay flag the page is also
 *  what the mission window opens on from now on. */
export function playScriptedCutscene(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'PlayCutscene' }>,
): void {
  retainMissionBriefing(pass.world, op.cutscene);
  if (op.replay) setMissionBriefingPage(pass.world, op.cutscene);
  pass.ctx.events.emit({ kind: 'missionCutscene', mission, page: op.cutscene, replay: op.replay });
  pass.halted = true;
}

export function playScriptedSound(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'PlaySound' }>,
): void {
  pass.ctx.events.emit({ kind: 'missionSound', soundType: op.sound, at: { ...op.point } });
}

export function moveScriptedCamera(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'SetCameraPosition' }>,
): void {
  pass.ctx.events.emit({ kind: 'missionCamera', point: { ...op.point } });
}

/** Follow the first human carrying the id, and select it too unless the flag says follow only. A
 *  missing human is the map's own data and reported as such. */
export function selectScriptedHuman(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SelectHuman' }>,
): void {
  const [first] = missionHumans(pass.world, op.humanId);
  if (first === undefined) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  pass.ctx.events.emit({ kind: 'missionSelectHuman', entity: first, select: !op.flag });
}

/** Name the first human carrying the id after the map's own string. */
export function nameScriptedHuman(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetHumanName' }>,
): void {
  const [first] = missionHumans(pass.world, op.humanId);
  if (first === undefined) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  nameHuman(pass.world, first, op.stringId);
}

/** Move one of the ten GUI marker slots to the point; the origin clears it (reading). */
export function setScriptedGuiMarker(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetGuiMarker' }>,
): void {
  if (!Number.isInteger(op.objectId) || op.objectId < 0 || op.objectId >= GUI_MARKER_SLOTS) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const placed = op.point.hx !== 0 || op.point.hy !== 0;
  emitPersistent(pass, { kind: 'missionGuiMarker', marker: op.objectId, point: { ...op.point }, placed });
}

export function setScriptedImportMarker(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'SetImportLandscapeMarker' }>,
): void {
  emitPersistent(pass, { kind: 'missionImportMarker', point: { ...op.point }, placed: op.flag });
}

/** Place or take away area markers on the hexagon ring `range` points out from the point, one every
 *  `index` steps of the walk (reading). */
export function setScriptedAreaMarkers(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'SetMapAreaMarker' | 'SetMapAreaMarkerMagic' }>,
): void {
  emitPersistent(pass, {
    kind: 'missionAreaMarkers',
    magic: op.opcode === 'SetMapAreaMarkerMagic',
    points: hexagonRing(op.point, Math.max(1, op.range), Math.max(1, op.index)),
    placed: op.flag,
  });
}

/** The six map-point directions in turning order; a diagonal lands on the row's parity the way
 *  {@link hexDistance} counts it, so every step is one map point. */
type HexDirection = 'east' | 'southEast' | 'southWest' | 'west' | 'northWest' | 'northEast';
const RING_SIDES: readonly HexDirection[] = [
  'east',
  'southEast',
  'southWest',
  'west',
  'northWest',
  'northEast',
];
const RING_START: HexDirection = 'northWest';

function stepHex(from: HalfCellNode, direction: HexDirection): HalfCellNode {
  const { hx, hy } = from;
  switch (direction) {
    case 'east':
      return { hx: hx + 1, hy };
    case 'west':
      return { hx: hx - 1, hy };
    case 'southEast':
      return { hx: (hy + 1) % 2 === 0 ? hx + 1 : hx, hy: hy + 1 };
    case 'southWest':
      return { hx: (hy + 1) % 2 === 0 ? hx : hx - 1, hy: hy + 1 };
    case 'northEast':
      return { hx: (hy - 1) % 2 === 0 ? hx + 1 : hx, hy: hy - 1 };
    case 'northWest':
      return { hx: (hy - 1) % 2 === 0 ? hx : hx - 1, hy: hy - 1 };
  }
}

/**
 * The map points at hexagon distance `radius` from `centre`, every `spacing`th step of a walk that
 * starts at the ring's north-western corner and turns through the six sides, `radius` steps each.
 * Approximation: the original walks the same ring from its own direction table; which corner it
 * starts at and which way it turns is unread, so a spacing above one may pick other points.
 */
function hexagonRing(centre: HalfCellNode, radius: number, spacing: number): HalfCellNode[] {
  let at = centre;
  for (let i = 0; i < radius; i++) at = stepHex(at, RING_START);
  const points: HalfCellNode[] = [];
  let step = 0;
  for (const side of RING_SIDES) {
    for (let i = 0; i < radius; i++) {
      if (step % spacing === 0) points.push(at);
      at = stepHex(at, side);
      step++;
    }
  }
  return points;
}

/** Rain or snow over the square of half-side `range` around the point, at the script's density in
 *  hundredths; a zero clears it (reading). */
export function setScriptedWeather(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'SetWeather' }>,
): void {
  const density = Math.min(WEATHER_DENSITY_MAX, Math.max(0, op.amount * WEATHER_DENSITY_SCALE));
  emitPersistent(pass, {
    kind: 'missionWeather',
    weather: op.flag ? 'snow' : 'rain',
    min: { hx: op.point.hx - op.range, hy: op.point.hy - op.range },
    max: { hx: op.point.hx + op.range, hy: op.point.hy + op.range },
    density,
  });
}

export function startScriptedEarthquake(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'StartEarthQuake' }>,
): void {
  pass.ctx.events.emit({ kind: 'missionEarthquake', seconds: Math.max(0, op.seconds) });
}

function emitPersistent(
  pass: MissionPass,
  event: Extract<
    SimEvent,
    { kind: 'missionGuiMarker' | 'missionImportMarker' | 'missionAreaMarkers' | 'missionWeather' }
  >,
): void {
  retainMissionPresentation(pass.world, event);
  pass.ctx.events.emit(event);
}
