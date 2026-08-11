import type { Camera } from '@open-northland/render';
import { uiScaleFor } from '../../hud/ui-scale.js';
import { cameraForViewportResize } from '../camera/index.js';

export interface GameViewportCoordinator {
  sync(width: number, height: number, nowMs: number): void;
  setUiScaleFactor(factor: number): Promise<boolean>;
  uiScaleFactor(): number;
  effectiveUiScale(): number;
}

export const HUD_RESIZE_SETTLE_MS = 120;
const MAX_AUTOMATIC_SCALE_RETRIES = 3;

export interface GameViewportCoordinatorOptions {
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly initialUiScaleFactor: number;
  /** A positive diagnostic override is absolute; `null` keeps viewport-responsive scaling. */
  readonly pinnedUiScale: number | null;
  readonly camera: () => Camera;
  readonly setCamera: (camera: Camera) => void;
  readonly currentUiScale: () => number;
  readonly requestUiScale: (scale: number) => Promise<boolean>;
}

export function createGameViewportCoordinator(
  options: GameViewportCoordinatorOptions,
): GameViewportCoordinator {
  let width = options.initialWidth;
  let height = options.initialHeight;
  let factor = options.initialUiScaleFactor;
  const pinnedUiScale = options.pinnedUiScale;
  const responsive = pinnedUiScale === null;
  let pendingScale: number | null = null;
  let resizeSettlesAtMs = 0;
  let activeScaleRequests = 0;
  let automaticRequestEpoch = 0;
  let automaticRetryCount = 0;
  let lastNowMs = 0;

  const effectiveUiScale = (): number => (responsive ? uiScaleFor(height, factor) : pinnedUiScale);
  const requestUiScale = async (scale: number): Promise<boolean> => {
    activeScaleRequests++;
    try {
      return await options.requestUiScale(scale);
    } finally {
      activeScaleRequests--;
    }
  };
  const retryAutomaticScale = (epoch: number): void => {
    if (epoch !== automaticRequestEpoch || automaticRetryCount >= MAX_AUTOMATIC_SCALE_RETRIES) return;
    automaticRetryCount++;
    pendingScale = effectiveUiScale();
    resizeSettlesAtMs = lastNowMs + HUD_RESIZE_SETTLE_MS;
  };

  return {
    sync: (nextWidth, nextHeight, nowMs) => {
      lastNowMs = nowMs;
      if (nextWidth !== width || nextHeight !== height) {
        automaticRequestEpoch++;
        automaticRetryCount = 0;
        options.setCamera(cameraForViewportResize(options.camera(), width, height, nextWidth, nextHeight));
        width = nextWidth;
        height = nextHeight;
        if (responsive) {
          pendingScale = effectiveUiScale();
          resizeSettlesAtMs = nowMs + HUD_RESIZE_SETTLE_MS;
        }
        return;
      }
      if (pendingScale === null || nowMs < resizeSettlesAtMs) return;
      const scale = pendingScale;
      pendingScale = null;
      if (scale !== options.currentUiScale() || activeScaleRequests > 0) {
        const epoch = ++automaticRequestEpoch;
        void requestUiScale(scale).then(
          (applied) => {
            if (applied) {
              if (epoch === automaticRequestEpoch) automaticRetryCount = 0;
              return;
            }
            retryAutomaticScale(epoch);
          },
          () => retryAutomaticScale(epoch),
        );
      }
    },
    setUiScaleFactor: async (nextFactor) => {
      automaticRequestEpoch++;
      automaticRetryCount = 0;
      const previousFactor = factor;
      factor = nextFactor;
      const nextScale = effectiveUiScale();
      pendingScale = null;
      if (!responsive || (nextScale === options.currentUiScale() && activeScaleRequests === 0)) return true;
      let applied = false;
      try {
        applied = await requestUiScale(nextScale);
      } catch {
        applied = false;
      }
      if (!applied) {
        factor = previousFactor;
        pendingScale = effectiveUiScale();
        resizeSettlesAtMs = 0;
      }
      return applied;
    },
    uiScaleFactor: () => factor,
    effectiveUiScale,
  };
}
