import type { MenuSettings } from './settings-store.js';

export type DisplayMode = MenuSettings['displayMode'];

export interface SettingsDisplayMode {
  request(mode: DisplayMode): void;
  reserve(mode: DisplayMode): { apply(): void; cancel(): void };
}

export function createSettingsDisplayMode(opts: {
  readonly current: () => DisplayMode;
  readonly enter: () => Promise<void>;
  readonly leave: () => Promise<void>;
  readonly commit: (mode: DisplayMode) => Promise<boolean>;
  readonly onSettled: () => void;
}): SettingsDisplayMode {
  interface Reservation {
    readonly settled: Promise<void>;
    settle(): void;
  }
  let desired: DisplayMode | null = null;
  let reserved: Reservation | null = null;
  let running = false;

  const start = (): void => {
    if (running) return;
    running = true;
    void run();
  };

  const run = async (): Promise<void> => {
    while (desired !== null) {
      const next = desired;
      desired = null;
      await (next === 'fullscreen' ? opts.enter() : opts.leave());
      while (reserved !== null) await reserved.settled;
      if (desired !== null) continue;
      const actual = opts.current();
      if (actual === next) await opts.commit(actual);
    }
    running = false;
    opts.onSettled();
  };

  return {
    request(mode): void {
      const held = reserved;
      reserved = null;
      desired = mode;
      held?.settle();
      start();
    },
    reserve(mode) {
      const previous = reserved;
      let settle = (): void => undefined;
      const token: Reservation = {
        settled: new Promise<void>((resolve) => {
          settle = resolve;
        }),
        settle: () => settle(),
      };
      reserved = token;
      previous?.settle();
      let active = true;
      return {
        apply(): void {
          if (!active) return;
          active = false;
          if (reserved !== token) return;
          reserved = null;
          desired = mode;
          token.settle();
          start();
        },
        cancel(): void {
          if (!active) return;
          active = false;
          if (reserved !== token) return;
          reserved = null;
          token.settle();
        },
      };
    },
  };
}
