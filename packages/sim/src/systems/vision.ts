import { Building, FOG_MODE, fogMode, Owner, Position, Settler, Vehicle } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { TerrainGraph } from '../nav/terrain.js';
import type { System } from './context.js';
import { isFighterJob, SCOUT_JOB } from './readviews/index.js';
import { HUNTER_JOB } from './readviews/tribes.js';

/**
 * The VISION / fog-of-war layer — per-PLAYER visibility masks over the map's CELL grid, driven by the
 * {@link import('../components/rules.js').FOG_MODE} the `setFogMode` command selects (default OFF:
 * an untouched world computes nothing and behaves exactly as before the feature — every golden holds).
 *
 * Design (OUR design — the original's exploration is observed behaviour, no readable fog source):
 *  - **Per player** ({@link Owner.player}), never per tribe: two players fielding vikings must not
 *    share eyes. Only OWNED entities see; wildlife/neutral fixtures reveal nothing (user decision
 *    2026-07-11).
 *  - **Cell resolution** (`W×H` visual cells, the half-cell lattice's `2W×2H` quartered): visibility
 *    is a coarse area effect, the render consumes per-cell lanes, and a cell mask is 4× smaller than a
 *    node mask on a 1024² map. Node queries quarter their coords ({@link cellOfNode}).
 *  - **Tri-state byte per cell** ({@link FOG_STATE}): UNEXPLORED (black), EXPLORED (terrain-only grey),
 *    VISIBLE (everything shows). REVEAL never downgrades (the original's sticky exploration); RECON/FULL
 *    drop VISIBLE back to EXPLORED each rebuild; RECON additionally *renders* UNEXPLORED as EXPLORED
 *    (the raw mask stays tri-state so switching modes mid-game keeps the explored history).
 *  - **Cadence rebuild** ({@link VISION_CADENCE_TICKS}): the masks are recomputed every few ticks (and
 *    on a mode change), not per tick — a fog a few ticks stale is imperceptible, and the rebuild cost
 *    (owned entities × vision area) amortizes to well under the movement system's budget (golden rule
 *    6: cost scales with active work — a world with no owned entities, or fog OFF, pays ~0).
 *
 * The masks live OUTSIDE the ECS ({@link FogState}, a `Simulation`-owned resource like the terrain
 * graph): a dense per-player byte grid inside a component would be deep-cloned per snapshot and walked
 * per `hashState` object-hash — pathological at map scale. They are still simulated STATE (combat
 * decisions read them), so `Simulation.hashState` mixes the raw bytes in after the components, and the
 * whole layer replays from the command log (mode changes are commands; the rebuild is a pure function
 * of tick + positions). Determinism: fixed integer ellipse math, canonical (ascending-player) mask
 * iteration, no RNG/wall-clock.
 */

/** The tri-state visibility values one mask byte holds. Order matters: a HIGHER state shows more, so
 *  "at least explored" is `>= EXPLORED` — the render + minimap key off these exact bytes. */
export const FOG_STATE = {
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
} as const;

/**
 * Ticks between visibility-mask rebuilds. The fog "scan pulse": positions move every tick but the
 * masks refresh on this cadence, so per-tick cost amortizes to (owned entities × vision area) / 5
 * writes. At 20 ticks/s that is a 250 ms refresh — imperceptible against fog's soft edges. OUR
 * design (the original has no observable fog refresh rate); a deliberate cadence like combat's
 * REPATH_CADENCE, not a magic number.
 */
export const VISION_CADENCE_TICKS = 5;

/**
 * Vision radii in half-cell NODES (the same integer node-distance convention as
 * `DEFAULT_WORK_FLAG_RADIUS` / `SIGHT_RADIUS_NODES`), measured along the E/W world axis (one node =
 * half a column = 34 px of the measured 68×38 pitch); the stamped area is the world-metric ellipse of
 * that radius, so vision reads circular on screen. ALL APPROXIMATED (user-tuned 2026-07-11): the
 * original carries no readable per-job sight field — the ordering (buildings large, scout largest,
 * soldier large, hunter a bit over civilian, civilian smallest) is the user's spec.
 */
export const BUILDING_VISION_NODES = 20;
export const CIVILIAN_VISION_NODES = 8;
export const HUNTER_VISION_NODES = 11;
export const SOLDIER_VISION_NODES = 16;
export const SCOUT_VISION_NODES = 26;

/**
 * The vision radius (nodes) of a settler of `jobType` — a data-shaped classification over the pinned
 * job-id bands (the {@link defaultStanceForJob} style): scouts widest, soldiers/heroes wide, hunters a
 * bit over civilians, every other trade (and a jobless settler/child) the civilian floor.
 */
export function visionRadiusForJob(jobType: number | null): number {
  if (jobType === SCOUT_JOB) return SCOUT_VISION_NODES;
  if (isFighterJob(jobType)) return SOLDIER_VISION_NODES;
  if (jobType === HUNTER_JOB) return HUNTER_VISION_NODES;
  return CIVILIAN_VISION_NODES;
}

/** The world-metric weights of the vision ellipse: one CELL column is 68 px wide, one cell ROW 38 px
 *  deep, one NODE (the radius unit) 34 px — the measured projection pitch (`nav/metric.ts`, source
 *  basis "projection"). Integer, so the ellipse test is exact integer arithmetic. */
const CELL_STEP_PX = 68;
const ROW_STEP_PX = 38;
const NODE_STEP_PX = 34;

/**
 * The per-player fog masks — a `Simulation`-owned world resource (like the terrain graph), NOT a
 * component (see the module doc for why). One `Uint8Array` of {@link FOG_STATE} bytes per player that
 * ever owned a positioned entity, allocated lazily (`W×H` cells each); `generation` bumps on every
 * rebuild so render layers re-composite only when the fog actually changed.
 */
export class FogState {
  /** Cell-grid dimensions (the half-cell lattice quartered). */
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** player → per-cell {@link FOG_STATE} bytes. Iterate via {@link playersWithMasks} (ascending) for
   *  any decision/hash — raw Map order is insertion order (history-dependent). */
  private readonly masks = new Map<number, Uint8Array>();
  /** Bumped on every rebuild/reset — the render's re-composite key (a read-path aid, never hashed). */
  generation = 0;
  /** The mode the LAST completed rebuild ran under — combat reads it (visionSystem runs earlier in the
   *  same tick, so it is current), and a change forces an off-cadence rebuild. Starts OFF. */
  activeMode: number = FOG_MODE.OFF;
  /** Tick of the last rebuild, -1 before the first — the cadence anchor. */
  lastRebuildTick = -1;

  constructor(terrain: TerrainGraph) {
    // The terrain graph is the 2W×2H half-cell lattice; cells quarter it (ceil for odd safety).
    this.cellsWide = Math.max(1, Math.ceil(terrain.width / 2));
    this.cellsHigh = Math.max(1, Math.ceil(terrain.height / 2));
  }

  /** The mask for `player`, allocated (all UNEXPLORED) on first use. */
  maskFor(player: number): Uint8Array {
    let mask = this.masks.get(player);
    if (mask === undefined) {
      mask = new Uint8Array(this.cellsWide * this.cellsHigh);
      this.masks.set(player, mask);
    }
    return mask;
  }

  /** The mask for `player` if it ever saw anything, else undefined (a maskless player sees nothing). */
  tryMaskFor(player: number): Uint8Array | undefined {
    return this.masks.get(player);
  }

  /** The players holding a mask, ASCENDING — the canonical iteration order for rebuilds and hashing. */
  playersWithMasks(): number[] {
    return [...this.masks.keys()].sort((a, b) => a - b);
  }

  /** Drop every mask (fog switched OFF): exploration history resets, generation bumps once. */
  reset(): void {
    if (this.masks.size === 0) return;
    this.masks.clear();
    this.generation++;
  }

  /** The RAW {@link FOG_STATE} of a cell for `player` (out-of-grid / maskless = UNEXPLORED). RECON's
   *  "terrain known from the start" is a VIEW mapping (see {@link effectiveFogState}), not raw state. */
  stateAt(player: number, cellX: number, cellY: number): number {
    if (cellX < 0 || cellY < 0 || cellX >= this.cellsWide || cellY >= this.cellsHigh) {
      return FOG_STATE.UNEXPLORED;
    }
    const mask = this.masks.get(player);
    return mask === undefined ? FOG_STATE.UNEXPLORED : (mask[cellY * this.cellsWide + cellX] ?? 0);
  }
}

/** The cell holding half-cell node (hx, hy) — the lane convention: cell (c, r) owns the 2×2 node
 *  block (2c..2c+1, 2r..2r+1) (`halfCellMapFromCells`, source basis: mapdat lane layout). */
export function cellOfNode(hx: number, hy: number): { cx: number; cy: number } {
  return { cx: hx >> 1, cy: hy >> 1 };
}

/**
 * The state a PLAYER'S EYE effectively sees at a cell under `mode` — the raw mask value with RECON's
 * one view rule applied (RECON starts with the terrain known: an UNEXPLORED cell reads EXPLORED).
 * This is the single mapping the render, the minimap and the headless checks share.
 */
export function effectiveFogState(
  fog: FogState,
  mode: number,
  player: number,
  cellX: number,
  cellY: number,
): number {
  const raw = fog.stateAt(player, cellX, cellY);
  if (mode === FOG_MODE.RECON && raw === FOG_STATE.UNEXPLORED) return FOG_STATE.EXPLORED;
  return raw;
}

/**
 * Whether `player` currently SEES the half-cell node (hx, hy) — its cell is {@link FOG_STATE.VISIBLE}.
 * The combat/AI gate (auto-acquire, flee threats): with fog OFF (or no fog resource — a mapless sim)
 * everything is seen, so every pre-fog behaviour is byte-identical. In REVEAL mode VISIBLE is sticky
 * (explored ground stays fully visible — the original's behaviour), so the gate follows automatically.
 */
export function playerSeesNode(fog: FogState | undefined, player: number, hx: number, hy: number): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const { cx, cy } = cellOfNode(hx, hy);
  return fog.stateAt(player, cx, cy) === FOG_STATE.VISIBLE;
}

/**
 * Whether `player` currently sees the entity `target` — {@link playerSeesNode} at the target's
 * position. The per-candidate form the combat auto-acquire and flee-threat filters compose into their
 * `accept` relations (full sim enforcement — user decision 2026-07-11: a unit in fog can be neither
 * auto-engaged nor fled from). A position-less target has no cell to hide in — seen. Pure read of the
 * frozen-this-tick mask (visionSystem runs earlier in SYSTEM_ORDER), so ring-search winners stay
 * deterministic.
 */
export function playerSeesEntity(
  world: World,
  fog: FogState | undefined,
  player: number,
  target: Entity,
): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const p = world.tryGet(target, Position);
  if (p === undefined) return true;
  const n = nodeOfPosition(p.x, p.y);
  return playerSeesNode(fog, player, n.hx, n.hy);
}

/**
 * VisionSystem — rebuild the per-player fog masks on the {@link VISION_CADENCE_TICKS} cadence (and
 * immediately on a mode change, so a `setFogMode` command takes effect the same tick — it runs in the
 * commandSystem, well before this system). Runs BEFORE the combatSystem in `SYSTEM_ORDER` so combat
 * always gates on this tick's (or at worst a cadence-stale) visibility.
 *
 * A rebuild is two passes over each player's mask:
 *  1. **Downgrade** — RECON/FULL drop every VISIBLE byte to EXPLORED (ground nobody watches regresses
 *     to terrain-only); REVEAL skips this (sticky exploration, the original's observed behaviour).
 *  2. **Stamp** — every OWNED positioned eye (settler by job / building / boat) writes VISIBLE over
 *     the world-metric ellipse of its vision radius. Stamping is idempotent + commutative, so the
 *     `query(Owner, Position)` store order needs no canonical sort (AGENTS.md: only picks do).
 *
 * Cost: zero when fog is OFF or no owned entity exists; otherwise O(players · cells) for the downgrade
 * + O(owned · radius²) for the stamps, every {@link VISION_CADENCE_TICKS} ticks.
 */
export const visionSystem: System = (world, ctx) => {
  const fog = ctx.fog;
  if (fog === undefined) return; // mapless sim — no grid to mask
  const mode = fogMode(world);
  if (mode === FOG_MODE.OFF) {
    if (fog.activeMode !== FOG_MODE.OFF) {
      fog.reset(); // fog switched off: drop the masks (exploration restarts if re-enabled)
      fog.activeMode = FOG_MODE.OFF;
      fog.lastRebuildTick = -1;
    }
    return;
  }

  const modeChanged = mode !== fog.activeMode;
  const due = fog.lastRebuildTick === -1 || ctx.tick - fog.lastRebuildTick >= VISION_CADENCE_TICKS;
  if (!modeChanged && !due) return;

  // Downgrade pass (RECON/FULL): ground no eye covers falls back to explored-grey. Masks are walked in
  // ascending-player order — byte-for-byte deterministic (and the order hashState mixes them in).
  if (mode !== FOG_MODE.REVEAL) {
    for (const player of fog.playersWithMasks()) {
      const mask = fog.maskFor(player);
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === FOG_STATE.VISIBLE) mask[i] = FOG_STATE.EXPLORED;
      }
    }
  }

  // Stamp pass: every owned eye writes VISIBLE over its vision ellipse (order-independent writes).
  for (const e of world.query(Owner, Position)) {
    const radius = visionRadiusOf(world, e);
    if (radius === null) continue; // an owned entity that is not an eye (a flag, a pile)
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const { cx, cy } = cellOfNode(n.hx, n.hy);
    stampVision(fog.maskFor(world.get(e, Owner).player), fog.cellsWide, fog.cellsHigh, cx, cy, radius);
  }

  fog.activeMode = mode;
  fog.lastRebuildTick = ctx.tick;
  fog.generation++;
};

/** The vision radius (nodes) of one owned entity, or null when it is not an eye: settlers see by job,
 *  buildings (finished or under construction — a rising site is manned ground) see the building
 *  radius, boat hulls see like a civilian. Owned markers (flags) and piles see nothing. */
function visionRadiusOf(world: World, e: Entity): number | null {
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) return visionRadiusForJob(settler.jobType);
  if (world.has(e, Building)) return BUILDING_VISION_NODES;
  if (world.has(e, Vehicle)) return CIVILIAN_VISION_NODES;
  return null;
}

/**
 * Write {@link FOG_STATE.VISIBLE} over the world-metric ellipse of `radiusNodes` around cell
 * (cx, cy): a cell (dc, dr) away is inside iff `(68·dc)² + (38·dr)² ≤ (34·R)²` — the measured 68×38
 * projection pitch with the radius in 34 px nodes, so the fog edge reads circular on screen (the
 * per-row stagger's ±half-cell wobble is deliberately ignored — a half-cell fringe on a soft fog edge,
 * named approximation). Exact integer math; clamped to the grid.
 */
export function stampVision(
  mask: Uint8Array,
  cellsWide: number,
  cellsHigh: number,
  cx: number,
  cy: number,
  radiusNodes: number,
): void {
  const radiusPx = radiusNodes * NODE_STEP_PX;
  const radiusSq = radiusPx * radiusPx;
  const dcMax = Math.floor(radiusPx / CELL_STEP_PX);
  const drMax = Math.floor(radiusPx / ROW_STEP_PX);
  const rLo = Math.max(0, cy - drMax);
  const rHi = Math.min(cellsHigh - 1, cy + drMax);
  for (let r = rLo; r <= rHi; r++) {
    const dyPx = (r - cy) * ROW_STEP_PX;
    const dySq = dyPx * dyPx;
    const cLo = Math.max(0, cx - dcMax);
    const cHi = Math.min(cellsWide - 1, cx + dcMax);
    const base = r * cellsWide;
    for (let c = cLo; c <= cHi; c++) {
      const dxPx = (c - cx) * CELL_STEP_PX;
      if (dxPx * dxPx + dySq <= radiusSq) mask[base + c] = FOG_STATE.VISIBLE;
    }
  }
}
