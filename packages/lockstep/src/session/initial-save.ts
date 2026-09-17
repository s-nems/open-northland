import { components, type Simulation } from '@open-northland/sim';
import type { GameSession } from './descriptor.js';

export interface InitialSaveIdentity {
  /** SHA-256 of the exact base64 snapshot text carried by the relay. */
  readonly fingerprint: string;
  readonly tick: number;
}

export function parseInitialSaveIdentity(value: unknown): InitialSaveIdentity {
  if (typeof value !== 'object' || value === null) throw new Error('initialSave must be an object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    throw new Error('initialSave.fingerprint must be a SHA-256 hex digest');
  }
  if (typeof raw.tick !== 'number' || !Number.isSafeInteger(raw.tick) || raw.tick < 0) {
    throw new Error('initialSave.tick must be a non-negative safe integer');
  }
  return { fingerprint: raw.fingerprint, tick: raw.tick };
}

/**
 * A saved room changes seat control on its first resumed tick; saved rules and diplomacy stay intact.
 * Only a seat changing hands is re-seated: a seat the save already runs as the room seats it keeps its
 * saved handlers and module toggles (the map's `[AIData]` rows), which a bare `setPlayerAi` would reset
 * to a full computer player.
 */
export function applyInitialSaveSeats(sim: Simulation, session: GameSession): void {
  if (session.initialSave === undefined || sim.tick !== session.initialSave.tick) {
    throw new Error('initial save seat setup requires the declared saved tick');
  }
  sim.commands.discardContinuation(
    (envelope) => envelope.origin === 'admin' && envelope.command.kind === 'setPlayerAi',
  );
  for (const seat of session.seats) {
    const enabled = seat.mode === 'ai';
    if (components.isAiPlayer(sim.world, seat.player) === enabled) continue;
    sim.enqueueSetup({ kind: 'setPlayerAi', player: seat.player, enabled });
  }
}
