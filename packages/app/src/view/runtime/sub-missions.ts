import {
  type ExportSaveOptions,
  parseSaveGame,
  type SaveGame,
  type SimEvent,
  type SubMissionTransition,
  serializeSaveGame,
} from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { replaySearch } from '../../game/match/session-url.js';
import { openSubMissionWindow } from '../../hud/dom/sub-mission-window.js';
import { swapToEntry } from '../../launch.js';
import type { SessionHost } from '../../session/index.js';
import { compressSaveText } from './save-load/codec.js';
import { clearPendingLoad, storePendingLoad } from './save-load/pending-store.js';
import { relaunchSearch } from './save-load/relaunch.js';
import type { SavedView } from './save-load/view-state.js';

/** The search that plays a sub-mission's whole mission again: its main map, the outermost parent,
 *  launched as it first was under a new seed. Null when that parent names no world. */
export function missionReplaySearch(parent: SaveGame): string | null {
  let main = parent;
  while (main.parent !== undefined) main = main.parent;
  const search = relaunchSearch(main.header);
  return search === null ? null : replaySearch(new URLSearchParams(search));
}

export type PrepareSubMission = (transition: SubMissionTransition, current: SaveGame) => Promise<SaveGame>;

export interface SubMissionDeps {
  readonly host: Pick<SessionHost, 'exportSave'>;
  /** The HUD scale the handover note is drawn at. */
  readonly hudScale: () => number;
  readonly captureSave?: (options: ExportSaveOptions) => SaveGame | Promise<SaveGame>;
  /** The view the parent save keeps, so the player's groups return with them. */
  readonly viewState?: () => SavedView | null;
  /** The presentation memory the parent save keeps, so the fog's memory returns with the groups. */
  readonly presentation?: () => string | null;
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
      const capture = deps.captureSave ?? ((options: ExportSaveOptions) => deps.host.exportSave(options));
      const current = await capture({
        mapId: deps.worldToken,
        entry: `?${deps.params}`,
        ...(deps.viewState !== undefined ? { view: deps.viewState() } : {}),
        ...(deps.presentation !== undefined ? { presentation: deps.presentation() } : {}),
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
      const dialog = openSubMissionWindow(deps.hudScale(), event.transition.kind);
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
