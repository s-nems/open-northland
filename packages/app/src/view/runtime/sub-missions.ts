import {
  exportSaveGame,
  parseSaveGame,
  type SaveGame,
  type SimEvent,
  type Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { swapToEntry } from '../../launch.js';
import { compressSaveText } from './save-load/codec.js';
import { clearPendingLoad, storePendingLoad } from './save-load/pending-store.js';
import { relaunchSearch } from './save-load/relaunch.js';
import { subMissionDialog } from './sub-mission-dialog.js';

export type SubMissionTransition = Extract<SimEvent, { kind: 'missionSubMission' }>['transition'];
export type PrepareSubMission = (transition: SubMissionTransition, current: SaveGame) => Promise<SaveGame>;

export interface SubMissionDeps {
  readonly sim: Simulation;
  readonly worldToken: string | null;
  readonly params: URLSearchParams;
  readonly parent?: SaveGame;
  readonly prepare?: PrepareSubMission;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly teardown: () => void;
}

export function createSubMissions(deps: SubMissionDeps): {
  onEvents(events: readonly SimEvent[]): boolean;
  isPending(): boolean;
} {
  let busy = false;
  const onEvents = (events: readonly SimEvent[]): boolean => {
    const event = events.find((event) => event.kind === 'missionSubMission');
    if (event === undefined) return false;
    if (busy) return true;
    busy = true;
    deps.pause();
    let leaving = false;
    const run = async (): Promise<void> => {
      if (deps.prepare === undefined || deps.worldToken === null)
        throw new Error('This world cannot load sub-missions');
      const current = exportSaveGame(deps.sim, {
        mapId: deps.worldToken,
        entry: `?${deps.params}`,
        ...(deps.parent !== undefined ? { parent: deps.parent } : {}),
      });
      const target = parseSaveGame(await deps.prepare(event.transition, current));
      const search = relaunchSearch(target.header);
      if (search === null) throw new Error('Sub-mission has no map identity');
      await storePendingLoad(await compressSaveText(serializeSaveGame(target)), true);
      await swapToEntry(search, () => {
        leaving = true;
        deps.teardown();
      });
    };
    // Let the frame finish reading its renderer before the handover disposes it.
    const attempt = (): void => {
      const dialog = subMissionDialog();
      void run()
        .then(() => dialog.dispose())
        .catch(async (err: unknown) => {
          await clearPendingLoad().catch(() => undefined);
          diag.warn(
            'missions',
            `mission ${event.transition.mission}: sub-mission transition failed: ${String(err)}`,
          );
          dialog.failed(
            attempt,
            leaving
              ? undefined
              : () => {
                  busy = false;
                  deps.resume();
                },
          );
        });
    };
    queueMicrotask(attempt);
    return true;
  };
  return { onEvents, isPending: () => busy };
}
