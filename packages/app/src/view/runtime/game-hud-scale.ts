export interface HudScaleTarget {
  setUiScale(scale: number): Promise<void>;
}

export interface GameHudScaleCoordinator {
  request(scale: number): Promise<boolean>;
  currentScale(): number;
  dispose(): void;
}

export interface GameHudScaleCoordinatorDeps {
  readonly initialScale: number;
  readonly targets: readonly HudScaleTarget[];
  readonly setPerfLeft: (scale: number) => void;
  readonly onError: (error: unknown) => void;
}

export function createGameHudScaleCoordinator(deps: GameHudScaleCoordinatorDeps): GameHudScaleCoordinator {
  let currentScale = deps.initialScale;
  let tail = Promise.resolve();
  let disposed = false;

  const apply = async (scale: number): Promise<boolean> => {
    if (disposed || scale === currentScale) return !disposed;
    const previousScale = currentScale;
    const results = await Promise.allSettled(deps.targets.map((target) => target.setUiScale(scale)));
    if (disposed) return false;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed === undefined) {
      currentScale = scale;
      deps.setPerfLeft(scale);
      return true;
    }

    const rollback = await Promise.allSettled(deps.targets.map((target) => target.setUiScale(previousScale)));
    if (!disposed) {
      deps.setPerfLeft(previousScale);
      deps.onError(failed.reason);
      const rollbackFailure = rollback.find((result) => result.status === 'rejected');
      if (rollbackFailure !== undefined) deps.onError(rollbackFailure.reason);
    }
    return false;
  };

  return {
    request(scale): Promise<boolean> {
      const completion = tail.then(() => apply(scale));
      tail = completion.then(
        () => undefined,
        () => undefined,
      );
      return completion;
    },
    currentScale: () => currentScale,
    dispose: () => {
      disposed = true;
    },
  };
}
