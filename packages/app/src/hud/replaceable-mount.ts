export interface DisposableMount {
  dispose(): void;
}

export interface ReplaceableMount<T extends DisposableMount> {
  current(): T;
  replace(key: number): Promise<void>;
  dispose(): void;
}

export type MountReplacement<T extends DisposableMount> = (key: number) => Promise<T>;

export type BeforeMountSwap<T extends DisposableMount> = (next: T, previous: T) => void | Promise<void>;

interface ReplacementRequest {
  readonly key: number;
  settled: boolean;
  resolve(): void;
  reject(reason: unknown): void;
}

function replacementRequest(key: number): {
  readonly request: ReplacementRequest;
  readonly completion: Promise<void>;
} {
  let resolveCompletion: () => void = () => undefined;
  let rejectCompletion: (reason: unknown) => void = () => undefined;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const request: ReplacementRequest = {
    key,
    settled: false,
    resolve(): void {
      if (request.settled) return;
      request.settled = true;
      resolveCompletion();
    },
    reject(reason: unknown): void {
      if (request.settled) return;
      request.settled = true;
      rejectCompletion(reason);
    },
  };
  return { request, completion };
}

export function createReplaceableMount<T extends DisposableMount>(
  initial: T,
  mount: MountReplacement<T>,
  beforeSwap?: BeforeMountSwap<T>,
): ReplaceableMount<T> {
  let active = initial;
  let queued: ReplacementRequest | null = null;
  let inFlight: ReplacementRequest | null = null;
  let running = false;
  let disposed = false;
  const disposedMounts = new WeakSet<DisposableMount>();

  const disposeMount = (value: T): void => {
    if (disposedMounts.has(value)) return;
    disposedMounts.add(value);
    value.dispose();
  };

  const drain = async (): Promise<void> => {
    while (!disposed && queued !== null) {
      const request = queued;
      queued = null;
      inFlight = request;

      let next: T;
      try {
        next = await mount(request.key);
      } catch (error: unknown) {
        request.reject(error);
        inFlight = null;
        continue;
      }

      if (disposed || queued !== null) {
        if (next !== active) disposeMount(next);
        request.resolve();
        inFlight = null;
        continue;
      }

      try {
        await beforeSwap?.(next, active);
      } catch (error: unknown) {
        if (next !== active) disposeMount(next);
        request.reject(error);
        inFlight = null;
        continue;
      }

      if (disposed || queued !== null) {
        if (next !== active) disposeMount(next);
        request.resolve();
        inFlight = null;
        continue;
      }

      const previous = active;
      active = next;
      if (previous !== next) disposeMount(previous);
      request.resolve();
      inFlight = null;
    }
    running = false;
  };

  const startDrain = (): void => {
    if (running || disposed) return;
    running = true;
    void drain();
  };

  return {
    current: () => active,
    replace(key): Promise<void> {
      if (disposed) return Promise.resolve();
      const { request, completion } = replacementRequest(key);
      queued?.resolve();
      queued = request;
      startDrain();
      return completion;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      queued?.resolve();
      queued = null;
      inFlight?.resolve();
      disposeMount(active);
    },
  };
}
