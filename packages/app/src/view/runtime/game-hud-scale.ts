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
  /** Applied one at a time in this order; the stage sorts by nothing, so a rebuild's `addChild`
   *  sequence is the HUD stacking order and must match the boot mounts. */
  readonly targets: readonly HudScaleTarget[];
  readonly setPerfLeft: (scale: number) => void;
  readonly onError: (error: unknown) => void;
}

export function createGameHudScaleCoordinator(deps: GameHudScaleCoordinatorDeps): GameHudScaleCoordinator {
  let currentScale = deps.initialScale;
  let tail = Promise.resolve();
  let disposed = false;

  const applyAll = async (
    scale: number,
    stopOnError: boolean,
  ): Promise<{ readonly reason: unknown } | null> => {
    let failure: { readonly reason: unknown } | null = null;
    for (const target of deps.targets) {
      try {
        await target.setUiScale(scale);
      } catch (reason: unknown) {
        failure ??= { reason };
        if (stopOnError) return failure;
      }
      if (disposed) return failure;
    }
    return failure;
  };

  const apply = async (scale: number): Promise<boolean> => {
    if (disposed || scale === currentScale) return !disposed;
    const previousScale = currentScale;
    const failure = await applyAll(scale, true);
    if (disposed) return false;
    if (failure === null) {
      currentScale = scale;
      deps.setPerfLeft(scale);
      return true;
    }

    // Roll every target back in mount order, so the stacking order survives the error path too.
    const rollbackFailure = await applyAll(previousScale, false);
    if (!disposed) {
      deps.setPerfLeft(previousScale);
      deps.onError(failure.reason);
      if (rollbackFailure !== null) {
        // Some target is stuck at the new scale; NaN never equals a request, so the next one retries.
        currentScale = Number.NaN;
        deps.onError(rollbackFailure.reason);
      }
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
