import { WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import {
  AiControl,
  AssistantMovesFlags,
  AssistantUpgradesTools,
  aiControlEntity,
  type ComputerModuleEnables,
  computerModuleEnables,
  DefenceMode,
  handOnMapBrief,
  Owner,
  playerPlacementTribes,
  Settler,
  Stance,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { disbandMilitia } from '../ai-shared/military/defence/militia.js';
import { COMPUTER_PUBLISHED_COUNTERS } from '../computer-player/assistant-counters.js';
import { soldierOutfitGoods } from '../computer-player/military/outfit.js';
import { settlementGrantGoods } from '../computer-player/workforce/grants.js';
import { forgetAllOffenders } from '../conflict/offenders.js';
import type { SystemContext } from '../context.js';
import { defaultStance, MILITARY_MODE, seatLeftToMapAi } from '../readviews/stances.js';
import { retireComputerCampaign, standDownAutonomousSorties, withdrawAiOrders } from './ai-lifecycle.js';
import {
  clearAssistantWeaponVetoes,
  liftAssistantSoldiersOnly,
  resetAssistantCounters,
  revokeAssistantGrants,
  setAssistantSwitch,
} from './assistant.js';

/**
 * Update machine identity and controller permissions together with their standing orders.
 * Counter publications, recruitment settings and campaigns are withdrawn when their required
 * permissions close. Shared defence remains active while map AI or autonomous military can run.
 */
export function setAiControl(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAiControl' }>,
): void {
  const wasLeft = seatLeftToMapAi(world, command.player);
  applyAiControl(world, ctx, command);
  if (!wasLeft && seatLeftToMapAi(world, command.player)) standFightersOnDefence(world, ctx, command.player);
}

/** Stand the seat's attacking fighters down to DEFEND, their places kept as the anchor, as the seat is left
 *  to map AI: a map places its people before their seat's controller is set, and a seat the computer stops
 *  commanding drops the attack its fighters held. A repeated setting leaves the stances the map AI's own
 *  tasks gave. A fighter whose own default is ATTACK, a weresnake or werewolf, keeps it. */
function standFightersOnDefence(world: World, ctx: SystemContext, player: number): void {
  for (const e of world.query(Stance, Owner)) {
    if (world.get(e, Owner).player !== player || world.get(e, Stance).mode !== MILITARY_MODE.ATTACK) continue;
    if (defaultStance(world, ctx.content, e, world.get(e, Settler).jobType) !== MILITARY_MODE.DEFEND)
      continue;
    world.mut(e, Stance).mode = MILITARY_MODE.DEFEND;
  }
}

function applyAiControl(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAiControl' }>,
): void {
  const carrier = aiControlEntity(world, command.player);
  if (!command.enabled) {
    if (carrier === null) return; // never AI-driven: nothing standing to withdraw
    disbandMilitia(world, ctx, command.player);
    withdrawAiOrders(world, ctx, command.player, () => true);
    retireComputerCampaign(world, command.player);
    handOnMapBrief(world, carrier);
    world.destroy(carrier);
    for (const { kinds } of COMPUTER_PUBLISHED_COUNTERS) resetAssistantCounters(world, command.player, kinds);
    withdrawMilitaryPublications(world, ctx, command.player);
    setAssistantSwitch(world, AssistantMovesFlags, command.player, false);
    setAssistantSwitch(world, AssistantUpgradesTools, command.player, false);
    revokeAssistantGrants(world, command.player, settlementGrantGoods(ctx));
    standDownAlarms(world, command.player);
    return;
  }
  const modules = computerModuleEnables(command.modules);
  const mapAiEnabled = command.mapAiEnabled ?? true;
  const tribe = playerPlacementTribes(world, command.player)?.[0];
  const computerEnabled =
    (command.computerEnabled ?? true) && tribe !== WEREWOLF_TRIBE && tribe !== WERESNAKE_TRIBE;
  if (carrier === null) {
    const created = world.create();
    const difficulty = command.difficulty ?? 'hard';
    world.add(created, AiControl, {
      player: command.player,
      modules,
      mapAiEnabled,
      computerEnabled,
      difficulty,
    });
    return;
  }
  const old = world.get(carrier, AiControl);
  const previous = computerModuleEnables(
    Object.fromEntries(
      Object.entries(old.modules).map(([id, enabled]) => [id, old.computerEnabled && enabled]),
    ),
  );
  const next = computerModuleEnables(
    Object.fromEntries(Object.entries(modules).map(([id, enabled]) => [id, computerEnabled && enabled])),
  );
  if (previous.military && !next.military) {
    standDownAutonomousSorties(world, ctx, command.player);
    disbandMilitia(world, ctx, command.player);
    forgetAllOffenders(world, command.player);
  }
  withdrawAiOrders(world, ctx, command.player, (source) => {
    if (source === 'map-ai') return !mapAiEnabled;
    // Autonomous sorties have no camp leash. A map-only controller must plan a bounded replacement.
    if (source === 'settlement-defence') return !next.military && (!mapAiEnabled || previous.military);
    return !next[source];
  });
  if (previous.military && !next.military) retireComputerCampaign(world, command.player);
  for (const entry of COMPUTER_PUBLISHED_COUNTERS) {
    if (publishes(previous, entry.modules) && !publishes(next, entry.modules)) {
      resetAssistantCounters(world, command.player, entry.kinds);
    }
  }
  if (previous.military && !next.military) withdrawMilitaryPublications(world, ctx, command.player);
  if (previous.collectResources && !next.collectResources) {
    setAssistantSwitch(world, AssistantMovesFlags, command.player, false);
    setAssistantSwitch(world, AssistantUpgradesTools, command.player, false);
    revokeAssistantGrants(world, command.player, settlementGrantGoods(ctx));
  }
  const seat = world.mut(carrier, AiControl);
  seat.modules = modules;
  seat.mapAiEnabled = mapAiEnabled;
  seat.computerEnabled = computerEnabled;
  if (!mapAiEnabled && !next.military) standDownAlarms(world, command.player);
  if (command.difficulty !== undefined) seat.difficulty = command.difficulty;
}

/** Lift the recruit weapon vetoes and the soldier outfit (its grants and their soldiers-only limits) the
 *  military module published for `player`. Like the vetoes and the published counter kinds, the outfit
 *  goods are the module's while it runs: a hand that set the same goods before loses them with it. */
function withdrawMilitaryPublications(world: World, ctx: SystemContext, player: number): void {
  clearAssistantWeaponVetoes(world, player);
  const outfit = soldierOutfitGoods(ctx);
  revokeAssistantGrants(world, player, outfit);
  liftAssistantSoldiersOnly(world, player, outfit);
}

/** Lower every alarm the seat is standing on, a hand-raised one included: the seat that would have called
 *  it off is the one being detached, and no drive lowers an alarm by itself. */
function standDownAlarms(world: World, player: number): void {
  const alarmed: Entity[] = [];
  for (const e of world.query(DefenceMode, Owner)) {
    if (world.get(e, Owner).player === player) alarmed.push(e);
  }
  for (const e of alarmed) world.remove(e, DefenceMode);
}

/** Whether every gate in `gates` is on - the conjunction that keeps an entry's counters published. */
function publishes(enables: ComputerModuleEnables, gates: readonly (keyof ComputerModuleEnables)[]): boolean {
  return gates.every((gate) => enables[gate]);
}
