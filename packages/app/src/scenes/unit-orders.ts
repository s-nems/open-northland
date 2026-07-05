import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Entity, type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **RTS unit orders** — a field of the human player's vikings the reviewer selects
 * (click / drag-box), sends (right-click), and re-professions (Space → panel), plus a neutral (unowned)
 * viking that must NOT be selectable/orderable and an owned HQ that can be inspected/demolished.
 *
 * The headless half proves the MECHANICS through the real command seam: a scripted `moveUnit` walks its
 * viking to a far target (arrives + stands there), a scripted `setJob` changes one viking's profession,
 * every spawned viking is owned by the human, and a `moveUnit` aimed at the NEUTRAL viking is skipped
 * (ownership gate). The interactive **action ring** (Space → original-art radial buttons that issue the same
 * `setJob`/`setStance`) is proven separately + headlessly by `test/action-ring-layout.test.ts` (a click on a
 * button maps to the right command). The pixels — the green selection rings, the marquee box, the round
 * order buttons — are the human's checklist (an agent can't self-judge them); the interactive
 * select/order/ring is wired in the `?scene=` browser entry, so the reviewer drives the SAME world the
 * checks assert.
 */

const WOOD = 1;
const IDLE = 0;
const WOODCUTTER = 1;
const CARPENTER = 2;
const CARRIER = 36;
const HEADQUARTERS = 1;
const HUMAN_PLAYER = 0;

const MAP_W = 24;
const MAP_H = 16;

const { Owner, PlayerOrder, Position, Settler } = components;

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-unit-orders-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1 },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter' },
      { typeId: CARPENTER, id: 'carpenter' },
      { typeId: CARRIER, id: 'carrier' },
    ],
    // A pure STORE headquarters (no workers) so the JobSystem never pulls the idle vikings off to staff
    // it — the cluster stays put, so the reviewer's selection/marquee acts on a stable group and the
    // headless move/hold checks are deterministic.
    buildings: [
      {
        typeId: HEADQUARTERS,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [],
        stock: [{ goodType: WOOD, capacity: 150, initial: 10 }],
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [{ typeId: VIKING, id: 'viking' }],
    atomicAnimations: [],
  });
}

/** A 5×4 block of the human's vikings — a group the reviewer can rubber-band select in one drag. */
const CLUSTER: ReadonlyArray<{ x: number; y: number }> = (() => {
  const out: Array<{ x: number; y: number }> = [];
  for (let row = 2; row < 6; row++) for (let col = 2; col < 7; col++) out.push({ x: col, y: row });
  return out;
})();
/** The scripted move-order source (cluster's first viking) and its far target. */
const SCOUT_AT = CLUSTER[0] as { x: number; y: number };
const MOVE_TARGET = { x: 20, y: 12 };
/** The scripted profession-change viking (cluster's second). */
const REJOB_AT = CLUSTER[1] as { x: number; y: number };
/** A NEUTRAL (unowned) viking — must be unselectable + unorderable (the ownership gate). */
const NEUTRAL_AT = { x: 2, y: 14 };
/** The human's headquarters — a selectable/demolishable building. */
const HQ_AT = { x: 14, y: 13 };

function build(sim: Simulation): void {
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    x: HQ_AT.x,
    y: HQ_AT.y,
    tribe: VIKING,
    owner: HUMAN_PLAYER,
  });
  for (const c of CLUSTER) {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: c.x,
      y: c.y,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
    });
  }
  // The neutral viking: same tribe, NO owner — belongs to no player, so no order may touch it.
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: NEUTRAL_AT.x, y: NEUTRAL_AT.y, tribe: VIKING });

  // Apply the spawns (one tick), then SCRIPT the player orders through the command seam — the same
  // moveUnit/setJob the browser's mouse issues — matched to their vikings by spawn position (nothing has
  // moved on tick 1). Deterministic: build() runs identically headless + in the browser.
  sim.step();
  const at = (cell: { x: number; y: number }): Entity | null => {
    for (const e of sim.world.query(Settler, Position)) {
      const p = sim.world.get(e, Position);
      if (p.x === fx.fromInt(cell.x) && p.y === fx.fromInt(cell.y)) return e;
    }
    return null;
  };
  const scout = at(SCOUT_AT);
  if (scout !== null) sim.enqueue({ kind: 'moveUnit', entity: scout, x: MOVE_TARGET.x, y: MOVE_TARGET.y });
  const rejob = at(REJOB_AT);
  if (rejob !== null) sim.enqueue({ kind: 'setJob', entity: rejob, jobType: CARPENTER });
  // A move order at the NEUTRAL viking — must be skipped (it has no Owner). Proves the gate headlessly.
  const neutral = at(NEUTRAL_AT);
  if (neutral !== null) sim.enqueue({ kind: 'moveUnit', entity: neutral, x: 20, y: 14 });
}

/** The human player's live settlers. */
function ownedSettlers(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) out.push(e);
  }
  return out;
}

/** Owned settlers standing exactly on `cell`. */
function ownedSettlersAt(sim: Simulation, cell: { x: number; y: number }): number {
  let n = 0;
  for (const e of ownedSettlers(sim)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === cell.x && fx.toInt(p.y) === cell.y) n++;
  }
  return n;
}

/** The single NEUTRAL (unowned) settler, or null. */
function neutralSettler(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Settler)) {
    if (!sim.world.has(e, Owner)) return e;
  }
  return null;
}

export const unitOrdersScene: SceneDefinition = {
  id: 'unit-orders',
  title: 'Rozkazy — zaznaczanie i ruch jednostek',
  summary:
    'Pole wikingów gracza (człowieka). Zaznacz pojedynczo (LPM) lub ramką (przeciągnij LPM) — pod ' +
    'zaznaczonymi pojawiają się zielone pierścienie. Kliknij prawym (PPM) na trawie, by ich tam wysłać ' +
    '(robotnik postoi chwilę i wróci do swoich zajęć). Spacja rozwija wokół jednostki PIERŚCIEŃ AKCJI w ' +
    'oryginalnej grafice — okrągłe drewniane przyciski: zmiana zawodu (dolny łuk) i postawa wojskowa (górny ' +
    'łuk). Info o jednostce jest zawsze w prawym dolnym rogu. Neutralny wiking (bez właściciela) nie daje ' +
    'się zaznaczyć ani rozkazać. HQ też można zaznaczyć i rozebrać.',
  seed: 4,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // The scripted scout walks ~28 tiles at ⅛/tick (~224 ticks) then its 50-tick civilian hold expires;
  // 340 leaves it idle exactly on the target for the position check.
  runTicks: 340,
  initialZoom: 1,
  checklist: [
    'Przeciągnij ramką po grupie wikingów — pod zaznaczonymi pojawiają się zielone pierścienie, a karta info (prawy dolny róg) pokazuje ich liczbę',
    'Kliknij prawym (PPM) na wolnej trawie — zaznaczeni wikingowie idą tam; robotnik po chwili postoju wraca do swoich zajęć',
    'Spacja rozwija PIERŚCIEŃ AKCJI wokół zaznaczonej jednostki: okrągłe drewniane przyciski w oryginalnej grafice (nie DOM-owe prostokąty), z sensownymi ikonami, na łuku POD jednostką (zawody) i NAD nią (postawy)',
    'Najedź na przycisk pierścienia — podświetla się i pokazuje podpowiedź z nazwą; kliknięcie zmienia zawód/postawę (a karta info to odzwierciedla), a klik między przyciskami nadal działa na jednostkę',
    'Neutralny wiking (na dole z lewej) NIE daje się zaznaczyć ramką ani kliknięciem i nie reaguje na PPM — należy do nikogo',
    'Kliknij budynek (HQ po prawej) — karta info pokazuje jego dane i ma przycisk „Rozbierz"',
  ],
  checks: [
    {
      label: 'a scripted moveUnit walked its owned viking to the far target (arrived + standing there)',
      predicate: (sim) => ownedSettlersAt(sim, MOVE_TARGET) === 1,
    },
    {
      label: 'a scripted setJob changed exactly one owned viking to carpenter',
      predicate: (sim) =>
        ownedSettlers(sim).filter((e) => sim.world.get(e, Settler).jobType === CARPENTER).length === 1,
    },
    {
      label: 'every spawned viking of the human is owned (20 in the cluster)',
      predicate: (sim) => ownedSettlers(sim).length === CLUSTER.length,
    },
    {
      label: 'a moveUnit aimed at the NEUTRAL (unowned) viking was skipped — no PlayerOrder, unmoved',
      predicate: (sim) => {
        const n = neutralSettler(sim);
        if (n === null) return false;
        const p = sim.world.get(n, Position);
        return (
          !sim.world.has(n, PlayerOrder) && fx.toInt(p.x) === NEUTRAL_AT.x && fx.toInt(p.y) === NEUTRAL_AT.y
        );
      },
    },
  ],
};
