import type { MapScript } from '@open-northland/data';
import { components, type Simulation } from '@open-northland/sim';
import { playerTribe } from './map-roster.js';

/** New worlds and legacy saves take placement authority from the same roster as the HUD. */
export function setupPlacementTribes(sim: Simulation, players: MapScript['players'] = []): void {
  const pending = new Set(
    sim.commands
      .pendingSnapshot()
      .flatMap((envelope) =>
        envelope.command.kind === 'setPlayerPlacementTribes' &&
        (envelope.origin === 'setup' || envelope.origin === 'admin')
          ? [envelope.command.player]
          : [],
      ),
  );
  for (let player = 0; player < components.MAX_PLAYERS; player++) {
    if (components.playerPlacementTribes(sim.world, player) !== null || pending.has(player)) continue;
    sim.enqueueSetup({
      kind: 'setPlayerPlacementTribes',
      player,
      tribes: [playerTribe({ players }, player)],
    });
  }
}
