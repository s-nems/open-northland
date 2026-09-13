import { applyInitialSaveSeats, type GameSession } from '@open-northland/lockstep';
import { verifyInitialSave } from './initial-save.js';
import type { OpenedWorld, WorldPort } from './relay-client.js';

function isInitial(session: GameSession, tick: number | null): boolean {
  return session.initialSave !== undefined && (tick === null || tick === session.initialSave.tick);
}

/** A descriptor world cannot silently substitute for the pinned save, even at tick zero. */
export async function openSessionWorld(
  port: WorldPort,
  session: GameSession,
  tick: number | null,
): Promise<OpenedWorld | null> {
  const opened = await port.open(session, tick);
  const initial = session.initialSave;
  if (
    initial !== undefined &&
    isInitial(session, tick) &&
    opened !== null &&
    (opened.initialSaveFingerprint !== initial.fingerprint ||
      opened.sim.tick !== initial.tick ||
      opened.generation !== initial.tick)
  )
    return null;
  return opened;
}

/** Verify the initial opaque transfer before allowing the host to interpret or publish it. */
export async function restoreSessionWorld(
  port: WorldPort,
  session: GameSession,
  snapshot: string,
  tick: number | null,
): Promise<OpenedWorld | null> {
  const initial = session.initialSave;
  const initialBoot = initial !== undefined && tick === initial.tick;
  if (initialBoot)
    await verifyInitialSave(snapshot, initial, session.world.kind === 'map' ? session.world.mapId : null);
  const opened = await port.restore(session, snapshot);
  if (
    initialBoot &&
    opened !== null &&
    (opened.sim.tick !== initial.tick || opened.generation !== initial.tick)
  ) {
    throw new Error('the restored initial save stands at another tick');
  }
  return opened;
}

/** Called only by the current loader's adoption callback; obsolete async worlds remain untouched. */
export function applyInitialSeatControl(
  opened: OpenedWorld,
  session: GameSession,
  tick: number | null,
): void {
  if (isInitial(session, tick)) applyInitialSaveSeats(opened.sim, session);
}
