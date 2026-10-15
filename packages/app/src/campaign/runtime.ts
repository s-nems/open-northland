import type { Campaign, CampaignMovie, MapTextLanguage } from '@open-northland/data';
import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { campaignMovies } from './locale.js';
import { grantCampaignMaps } from './progress.js';

type Grant = { readonly campaignId: number; readonly mapId: number };
type SavedCampaign = { readonly unlockedMaps: readonly Grant[]; readonly video: number | undefined };

export interface CampaignRuntimeDeps {
  readonly campaign?: Campaign;
  /** The running mission's text language, which picks the films. */
  readonly language: MapTextLanguage;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly pause: () => void;
  readonly resume: () => void;
  /** Plays a script video; `undefined` when the campaign has no film for the sequence. */
  readonly play: (movie: CampaignMovie | undefined) => Promise<void>;
  readonly exit: () => void;
  readonly failed: (retry: () => void) => void;
  readonly signal: AbortSignal;
}

/** All grants persist before any handover; a failed write keeps the exact batch for retry. */
export function createCampaignRuntime(deps: CampaignRuntimeDeps): {
  restore(snapshot: WorldSnapshot): void;
  events(events: readonly SimEvent[], proceed: (events: readonly SimEvent[]) => void): void;
  isPending(): boolean;
} {
  let pending = false;
  const queued: { events: readonly SimEvent[]; proceed: (events: readonly SimEvent[]) => void }[] = [];
  const persist = (grants: readonly Grant[]): void => {
    if (grants.length > 0 && deps.campaign !== undefined)
      grantCampaignMaps(deps.campaign, grants, deps.storage);
  };
  const finishMovie = (): void => {
    if (deps.signal.aborted) return;
    try {
      persist(
        queued.flatMap(({ events }) => events.filter((event) => event.kind === 'missionCampaignUnlock')),
      );
    } catch {
      deps.failed(finishMovie);
      return;
    }
    queued.length = 0;
    deps.exit();
  };
  const run = (grants: readonly Grant[], video: number | undefined, proceed: () => void): void => {
    if (deps.signal.aborted) return;
    const attempt = (): void => {
      if (deps.signal.aborted) return;
      try {
        persist(grants);
      } catch {
        pending = true;
        deps.pause();
        deps.failed(attempt);
        return;
      }
      pending = false;
      if (video === undefined) {
        deps.resume();
        proceed();
        while (!pending && queued.length > 0) {
          const next = queued.shift();
          if (next !== undefined) handle(next.events, next.proceed);
        }
        return;
      }
      pending = true;
      deps.pause();
      // End the frame before mounting media or disposing the world on completion.
      queueMicrotask(() => {
        if (deps.signal.aborted) return;
        const movie =
          deps.campaign === undefined
            ? undefined
            : campaignMovies(deps.campaign, deps.language).videos.find((movie) => movie.sequence === video);
        void deps
          .play(movie)
          .then(finishMovie)
          .catch(() => {
            if (!deps.signal.aborted) deps.failed(attempt);
          });
      });
    };
    attempt();
  };
  const handle = (events: readonly SimEvent[], proceed: (events: readonly SimEvent[]) => void): void => {
    if (deps.signal.aborted) return;
    if (pending) {
      queued.push({ events: [...events], proceed });
      return;
    }
    const grants: Grant[] = [];
    let video: number | undefined;
    for (const event of events) {
      if (event.kind === 'missionCampaignUnlock') grants.push(event);
      if (event.kind === 'missionVideo') video = event.sequence;
    }
    if (grants.length === 0 && video === undefined) {
      proceed(events);
      return;
    }
    const retained = [...events];
    run(grants, video, () => proceed(retained));
  };

  return {
    restore(snapshot) {
      // A one-off restore read, not a frame scan. Component state is validated by the save reader.
      const saved = snapshot.entities.find((entity) => entity.components.MissionCampaign !== undefined)
        ?.components.MissionCampaign as SavedCampaign | undefined;
      if (saved !== undefined) run(saved.unlockedMaps, saved.video, () => undefined);
    },
    events: handle,
    isPending: () => pending,
  };
}
