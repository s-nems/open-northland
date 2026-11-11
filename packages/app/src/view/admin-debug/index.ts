import type { SessionClock } from '@open-northland/lockstep';
import {
  type Command,
  type Entity,
  FOG_MODE,
  type FogMode,
  type FogSettings,
  fogModeOf,
  fogSettings,
  systems,
} from '@open-northland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place/index.js';
import { type AdminPanel, createAdminPanel } from '../../hud/dom/admin-panel/index.js';
import type { AdminSkills, AdminWorldState, FogMapKey } from '../../hud/dom/admin-panel/model.js';
import type { GoodIconPainter } from '../../hud/dom/good-art.js';
import { UNLIMITED_GAME_SPEED } from '../../hud/tool-panel/game-speed.js';
import type { StandingStructure } from '../../hud/tool-panel/placement.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { DebugAction, DebugTargetKind } from './actions-catalog.js';
import { type AiSeatReading, aiSeatRows } from './ai-seats.js';
import { createHoldRepeat } from './hold-repeat.js';
import { createAdminLabels } from './labels.js';
import { adminOwners } from './owners.js';
import {
  type AnimalEntry,
  type ArmorEntry,
  animalSpawnCommand,
  creatureSpawnCommand,
  DEFAULT_SOLDIER_WEAPON,
  type GoodEntry,
  goodDropCommand,
  personSpawnCommand,
  SOLDIER_WEAPONS,
  soldierSpawnCommand,
  type VehicleEntry,
  vehicleSpawnCommand,
} from './spawn-catalog.js';
import { type Armed, armedKey, type BuildingEntry, createAdminToolCatalogue, NO_ARMOR } from './tools.js';

/**
 * The debug tools: arm a tool in the panel, then click the map to drop a test entity or run an entity
 * action on what is already there. Every poke goes through the sim command seam, so it stays as
 * replay-faithful as a player order. The session owns its listeners and DOM lifetime: a world torn
 * down in place disposes it before the next one mounts its own.
 */

export interface AdminDebugDeps {
  readonly canvas: HTMLCanvasElement;
  /** The DOM HUD plane the panel drops onto. */
  readonly plane: HTMLElement;
  readonly enqueue: (command: Command) => void;
  /** Map a client point to a map tile, null off the map. */
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** Pick the top entity of `kind` under a client point, any owner unlike the RTS selection. Absent
   *  leaves the action tools inert. */
  readonly pickEntity?: (clientX: number, clientY: number, kind: DebugTargetKind) => number | null;
  /** True when a client point is over the HUD, where a click is the HUD's rather than a map spawn. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** Localized display name for a good typeId, or `undefined` to keep the catalog's built-in label. */
  readonly goodLabel?: (typeId: number) => string | undefined;
  /** Owner slot to its roster tribe: a spawn is stamped for the slot it is dropped for, so it can work
   *  that slot's buildings. */
  readonly seatTribeOf: (player: number) => number;
  /** The session's roster seats; empty or absent lists the first slots. */
  readonly seats?: readonly number[];
  /** Seat to the team colour it wears; absent keeps each slot's own colour. */
  readonly seatColourOf?: (player: number) => number;
  /** Hand the HUD's placement tools a finished structure for an owner; false when they cannot take it.
   *  Absent hides the structures and buildings groups. */
  readonly enterStanding?: (structure: StandingStructure, owner: number, tribe: number) => boolean;
  /** Drop the HUD's held placement, so an armed map tool is the only one taking clicks. */
  readonly cancelPlacement?: () => void;
  /** The building types the buildings group offers. */
  readonly buildings?: readonly BuildingEntry[];
  /** Every good the running content defines, each droppable as a loose pile. Live-sourced, so no entry
   *  can trip the sim's `dropGood` content guard. */
  readonly goods: readonly GoodEntry[];
  /** The armors a soldier may wear, in class order. */
  readonly armors: readonly ArmorEntry[];
  /** The starting experience of a man spawned with every profession learned. */
  readonly learnedExperience: readonly (readonly [number, number])[];
  /** Wildlife entries, each spawnable as its data-pinned herd. Empty or absent hides the group. */
  readonly animals?: readonly AnimalEntry[];
  /** The running content's vehicle types. Empty or absent hides the group. */
  readonly vehicles?: readonly VehicleEntry[];
  /** The sim's live needs rule. */
  readonly needsEnabled?: () => boolean;
  /** The sim's live waiver of the grass wells and hives stand on. */
  readonly bioGroundWaived?: () => boolean;
  /** The sim's live fog mode. Absent hides the visibility settings. */
  readonly fogMode?: () => FogMode;
  readonly geometryEnabled: () => boolean;
  readonly setGeometryEnabled: (enabled: boolean) => void;
  readonly zoomOutUnlocked: () => boolean;
  readonly setZoomOutUnlocked: (unlocked: boolean) => void;
  /** The session's own clock, for the debug tempos. Absent (a shared clock) hides the row. */
  readonly clock?: Pick<SessionClock, 'speed' | 'setSpeed'>;
  readonly paintGood?: GoodIconPainter;
  /** The running computer seats as the world stands now, read only while the AI tab shows. Absent
   *  leaves the tab empty. */
  readonly aiSeats?: () => readonly AiSeatReading[];
}

export interface AdminDebugHandle {
  /** The panel's toggle, which the owner stands in the system bar. */
  readonly toggle: HTMLElement;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** The pool an untouched spawn gets, so the field shows it. */
const DEFAULT_HITPOINTS = systems.HUMAN_HITPOINTS;
/** The action tools' health share until the field is edited. */
const DEFAULT_HEALTH_PERCENT = 1;
/** The debug tempos beyond the HUD's ×1..×3, for watching a map script's slow chains, up to unlimited. */
const DEBUG_GAME_SPEEDS: readonly number[] = [5, 10, 20, 30, 60, UNLIMITED_GAME_SPEED];
/** How often the shown AI tab reads the world again. A strategy review comes every few game minutes, so
 *  once a second keeps up even at the debug tempos without a per-frame read. */
const AI_REFRESH_MS = 1000;

const FOG_MAP_SETTINGS: Readonly<Record<Exclude<FogMapKey, 'off'>, boolean>> = {
  classic: false,
  recon: true,
};

function fogMapOf(settings: FogSettings | null): FogMapKey {
  if (settings === null) return 'off';
  return settings.terrainKnown ? 'recon' : 'classic';
}

/** Mount the debug tools with the panel closed; the owner places `toggle`. */
export function mountAdminDebug(deps: AdminDebugDeps): AdminDebugHandle {
  const { canvas } = deps;
  const msgs = messages();
  const copy = msgs.admin;
  const seatColourOf = deps.seatColourOf ?? ((player: number): number => player);
  const labels = createAdminLabels(msgs, deps.goodLabel, seatColourOf);
  const catalogue = createAdminToolCatalogue(msgs, labels, {
    goods: deps.goods,
    armors: deps.armors,
    animals: deps.animals ?? [],
    vehicles: deps.vehicles ?? [],
    standing:
      deps.enterStanding === undefined
        ? { wall: false, road: false, buildings: [] }
        : { wall: true, road: true, buildings: deps.buildings ?? [] },
  });
  // The goods table in the weapon-lookup seam shape (`GoodEntry` names the typeId `good`).
  const spawnGoods = deps.goods.map((g) => ({ typeId: g.good, id: g.id }));

  let armed: Armed | null = null;
  let player = HUMAN_PLAYER;
  let hitpoints = DEFAULT_HITPOINTS;
  let healthPercent = DEFAULT_HEALTH_PERCENT;
  let weapon = DEFAULT_SOLDIER_WEAPON;
  let armor: ArmorEntry | null = null;
  let skills: AdminSkills = 'basic';
  // The rules as last requested: a command applies next tick, so the sim's read lags a click.
  let needs = deps.needsEnabled?.() ?? true;
  let bioGround = deps.bioGroundWaived?.() ?? false;
  let fog: FogSettings | null = fogSettings(deps.fogMode?.() ?? FOG_MODE.OFF);

  // A held spawn press keeps dropping at the pointer, following it, until the button comes up.
  const hold = createHoldRepeat();
  let heldAt: { clientX: number; clientY: number; onCanvas: boolean } | null = null;
  const stopHold = (): void => {
    hold.stop();
    heldAt = null;
  };

  const worldState = (): AdminWorldState => ({
    needs,
    bioGround,
    fog: deps.fogMode === undefined ? null : { map: fogMapOf(fog), fogOfWar: fog?.fogOfWar === true },
    geometry: deps.geometryEnabled(),
    zoomOut: deps.zoomOutUnlocked(),
    speed: deps.clock?.speed ?? null,
  });
  const requestFog = (next: FogSettings | null): void => {
    fog = next;
    deps.enqueue({ kind: 'setFogMode', mode: next === null ? FOG_MODE.OFF : fogModeOf(next) });
    panel.showWorld(worldState());
  };

  let aiTimer: ReturnType<typeof setInterval> | undefined;
  const showAi = (): void => panel.showAi(aiSeatRows(deps.aiSeats?.() ?? [], msgs));
  const setAiShown = (shown: boolean): void => {
    clearInterval(aiTimer);
    aiTimer = undefined;
    if (!shown) return;
    showAi();
    aiTimer = setInterval(showAi, AI_REFRESH_MS);
  };

  const setArmed = (next: Armed | null): void => {
    stopHold();
    if (next !== null) deps.cancelPlacement?.();
    armed = next;
    panel.showArmed(next === null ? null : catalogue.describe(next, player));
    canvas.style.cursor = next === null ? '' : 'var(--cursor-crosshair, crosshair)';
  };

  const panel: AdminPanel = createAdminPanel(
    deps.plane,
    {
      owners: adminOwners(deps.seats ?? [], seatColourOf, labels.player),
      owner: player,
      hitpoints,
      weapons: catalogue.weapons,
      weapon: weapon.jobType,
      armors: catalogue.armors,
      armor: NO_ARMOR,
      skills,
      groups: catalogue.groups,
      actions: catalogue.actions,
      healthPercent,
      hasFog: deps.fogMode !== undefined,
      speeds: deps.clock === undefined ? [] : DEBUG_GAME_SPEEDS,
      ...(deps.paintGood !== undefined ? { paintGood: deps.paintGood } : {}),
    },
    {
      onOpen: (open) => {
        // Closing disarms, so no stray crosshair click survives the panel.
        if (!open) {
          setArmed(null);
          return;
        }
        // A scene's own boot toggle, or the HUD's speed buttons, may have moved these since.
        needs = deps.needsEnabled?.() ?? needs;
        bioGround = deps.bioGroundWaived?.() ?? bioGround;
        if (deps.fogMode !== undefined) fog = fogSettings(deps.fogMode());
        panel.showWorld(worldState());
      },
      onAiView: setAiShown,
      onTool: (key) => {
        const choice = catalogue.choiceOf(key);
        if (choice === undefined) return;
        if (choice.kind === 'standing') {
          setArmed(null);
          deps.enterStanding?.(choice.structure, player, deps.seatTribeOf(player));
          return;
        }
        setArmed(armed !== null && armedKey(armed) === key ? null : choice);
      },
      onDisarm: () => setArmed(null),
      onOwner: (next) => {
        player = next;
        if (armed !== null) panel.showArmed(catalogue.describe(armed, player));
      },
      onHitpoints: (next) => {
        hitpoints = next;
      },
      onWeapon: (job) => {
        weapon = SOLDIER_WEAPONS.find((entry) => entry.jobType === job) ?? weapon;
      },
      onArmor: (armorClass) => {
        armor = deps.armors.find((entry) => entry.armorClass === armorClass) ?? null;
      },
      onSkills: (next) => {
        skills = next;
      },
      onHealthPercent: (next) => {
        healthPercent = next;
      },
      onNeeds: (enabled) => {
        needs = enabled;
        deps.enqueue({ kind: 'setNeedsEnabled', enabled });
        panel.showWorld(worldState());
      },
      onBioGround: (waived) => {
        bioGround = waived;
        deps.enqueue({ kind: 'setBioGroundWaived', waived });
        panel.showWorld(worldState());
      },
      onFogMap: (map) => {
        requestFog(
          map === 'off' ? null : { terrainKnown: FOG_MAP_SETTINGS[map], fogOfWar: fog?.fogOfWar ?? false },
        );
      },
      onFogOfWar: (enabled) => {
        if (fog !== null) requestFog({ ...fog, fogOfWar: enabled });
      },
      onGeometry: (enabled) => {
        deps.setGeometryEnabled(enabled);
        panel.showWorld(worldState());
      },
      onZoomOut: (unlocked) => {
        deps.setZoomOutUnlocked(unlocked);
        panel.showWorld(worldState());
      },
      onSpeed: (multiplier) => {
        deps.clock?.setSpeed(multiplier);
        panel.showWorld(worldState());
      },
    },
  );

  const spawnAtTile = (col: number, row: number): void => {
    if (armed === null || armed.kind === 'action' || armed.kind === 'teleport') return;
    if (armed.kind === 'animal') {
      deps.enqueue(animalSpawnCommand(armed.entry.tribe, col, row));
      return;
    }
    if (armed.kind === 'resource') {
      const command = resourceCommand(armed.good, col, row);
      if (command !== null) deps.enqueue(command);
      return;
    }
    if (armed.kind === 'good') {
      deps.enqueue(goodDropCommand(armed.good, col, row));
      return;
    }
    if (armed.kind === 'vehicle') {
      const tribe = deps.seatTribeOf(player);
      deps.enqueue(vehicleSpawnCommand(armed.entry.vehicleType, { player, tribe, x: col, y: row }));
      return;
    }
    if (armed.kind === 'creature') {
      deps.enqueue(creatureSpawnCommand(armed.preset, { player, hitpoints, x: col, y: row }));
      return;
    }
    const person = { player, tribe: deps.seatTribeOf(player), hitpoints, x: col, y: row };
    if (armed.kind === 'soldier') {
      deps.enqueue(soldierSpawnCommand({ ...person, weapon, armor, goods: spawnGoods }));
      return;
    }
    const learned = armed.preset.learns === true && skills === 'all';
    deps.enqueue(
      personSpawnCommand(armed.preset, learned ? { ...person, experience: deps.learnedExperience } : person),
    );
  };

  const spawnAtPointer = (clientX: number, clientY: number): void => {
    if (deps.claimPointer(clientX, clientY)) return;
    const tile = deps.clientToTile(clientX, clientY);
    if (tile !== null) spawnAtTile(tile.col, tile.row);
  };

  /** Applies to the entity under the cursor; a no-op click when none is there or no picker was handed in. */
  const applyActionAt = (clientX: number, clientY: number, action: DebugAction): void => {
    // Picking is number-typed end to end, so the `Entity` brand is reconstituted at this app-to-sim seam.
    const ref = deps.pickEntity?.(clientX, clientY, action.targetKind) ?? null;
    if (ref !== null) deps.enqueue(action.command(ref as Entity, healthPercent));
  };

  /** One beat of a press that repeats while held: a spawn, or a sweeping action on what is under it. */
  const actAtPointer = (clientX: number, clientY: number): void => {
    if (armed?.kind !== 'action') {
      spawnAtPointer(clientX, clientY);
      return;
    }
    if (!deps.claimPointer(clientX, clientY)) applyActionAt(clientX, clientY, armed.action);
  };

  /** First click picks the settler, the next sends it to the clicked node and re-arms for another pick.
   *  The sim drops a destination on unwalkable ground, so a miss there leaves the settler where it was. */
  const teleportAt = (clientX: number, clientY: number, target: Entity | null): void => {
    if (target === null) {
      const ref = deps.pickEntity?.(clientX, clientY, 'settler') ?? null;
      if (ref !== null) setArmed({ kind: 'teleport', target: ref as Entity });
      return;
    }
    const tile = deps.clientToTile(clientX, clientY);
    if (tile === null) return;
    deps.enqueue({ kind: 'debugTeleport', target, x: tile.col, y: tile.row });
    setArmed({ kind: 'teleport', target: null });
  };

  // Capture on `window` runs before the canvas's RTS-control listeners, so an armed press can consume
  // the click and act instead of selecting.
  const onPointerDown = (e: MouseEvent): void => {
    if (armed === null) return;
    if (e.button === 2) {
      setArmed(null);
      e.preventDefault();
      e.stopPropagation(); // do not also fall through to a move or attack order
      return;
    }
    if (e.button !== 0) return; // middle button stays the camera pan
    if (e.target !== canvas) return; // a click on the panel itself, not the map
    if (deps.claimPointer(e.clientX, e.clientY)) return;
    // Consume the armed left-press even when it hits nothing, so it never clears the unit selection.
    if (armed.kind === 'teleport') {
      teleportAt(e.clientX, e.clientY, armed.target);
    } else if (armed.kind === 'action' && armed.action.sweeps !== true) {
      applyActionAt(e.clientX, e.clientY, armed.action);
    } else {
      actAtPointer(e.clientX, e.clientY);
      heldAt = { clientX: e.clientX, clientY: e.clientY, onCanvas: true };
      hold.start(() => {
        if (heldAt?.onCanvas === true) actAtPointer(heldAt.clientX, heldAt.clientY);
      });
    }
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('mousedown', onPointerDown, { capture: true });

  const onPointerUp = (e: MouseEvent): void => {
    if (e.button === 0) stopHold();
  };
  window.addEventListener('mouseup', onPointerUp, { capture: true });
  window.addEventListener('blur', stopHold);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && armed !== null) {
      setArmed(null);
      e.stopPropagation(); // don't also clear the unit selection (unit-controls' Esc)
    }
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });

  /** The half-cell node under the pointer, so a spot on the map can be named exactly. Shift holds the
   *  readout, so the pointer can travel to the copy button without dragging it along. */
  const onPointerMove = (e: MouseEvent): void => {
    if (heldAt !== null) heldAt = { clientX: e.clientX, clientY: e.clientY, onCanvas: e.target === canvas };
    if (!panel.isOpen() || e.shiftKey || e.target !== canvas) return;
    const tile = deps.clientToTile(e.clientX, e.clientY);
    panel.showCursor(
      tile === null
        ? copy.cursorOffMap
        : formatMessage(copy.cursorNode, { x: tile.col, y: tile.row, cx: tile.col >> 1, cy: tile.row >> 1 }),
    );
  };
  window.addEventListener('mousemove', onPointerMove, { passive: true });

  return {
    toggle: panel.toggle,
    setVisible: (visible) => panel.setVisible(visible),
    dispose(): void {
      stopHold();
      setAiShown(false);
      canvas.style.cursor = '';
      window.removeEventListener('mousedown', onPointerDown, { capture: true });
      window.removeEventListener('mouseup', onPointerUp, { capture: true });
      window.removeEventListener('blur', stopHold);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('mousemove', onPointerMove);
      panel.dispose();
    },
  };
}
