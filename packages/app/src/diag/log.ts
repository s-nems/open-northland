/**
 * The app-wide diagnostics logger — one backbone with named channels and severity levels, two sinks:
 * the browser console (dev-readable, level-filtered) and a bounded in-memory ring of plain
 * JSON-serializable entries. The ring is the artifact a future diagnostics bundle serializes, so a
 * tester report can carry everything that was logged before a failure (see
 * docs/tickets/app/crash-capture-diagnostics-bundle.md).
 *
 * App-local by design: `packages/sim` stays log-free (purity — sim facts enter the log at the app
 * boundary), and render/audio get access only when a real second caller appears. The core is
 * DOM-free so headless tests and node imports work; browser-only facts live in `env-header.ts`.
 */

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error';

/** Severity order for level filtering — a sink at level L passes entries ranked >= L. */
const LEVEL_RANK: Readonly<Record<DiagLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** One logged fact — plain data, JSON-serializable (data is normalized at log time). */
export interface DiagEntry {
  /** Milliseconds since page/process start (the injected `now` clock; `performance.now()` by default). */
  readonly timeMs: number;
  readonly channel: string;
  readonly level: DiagLevel;
  readonly message: string;
  /** Extra structured context, normalized to a JSON-safe value at log time (Errors → plain objects). */
  readonly data?: unknown;
}

/** The four console methods the console sink dispatches to — injectable so tests capture output. */
export type ConsoleSink = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export interface DiagLogOptions {
  /** Max ring entries retained; oldest dropped beyond it. */
  readonly ringCapacity?: number;
  /** Minimum level echoed to the console (`'silent'` = ring only). Default `'info'`. */
  readonly consoleLevel?: DiagLevel | 'silent';
  readonly console?: ConsoleSink;
  readonly now?: () => number;
}

/** Everything is retained in the ring; only the console echo is filtered. */
const DEFAULT_RING_CAPACITY = 4000;
const DEFAULT_CONSOLE_LEVEL: DiagLevel = 'info';

/**
 * Normalize log data to a JSON-safe value: an `Error` (the common `catch` payload) becomes a plain
 * `{name, message, stack}` object so `JSON.stringify` keeps it; everything else passes through —
 * callers pass plain data, and the bundle serializer owns any last-resort fallback.
 */
function toJsonSafe(data: unknown): unknown {
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      ...(data.stack !== undefined ? { stack: data.stack } : {}),
    };
  }
  return data;
}

export class DiagLog {
  private readonly ringCapacity: number;
  private readonly consoleSink: ConsoleSink;
  private readonly now: () => number;
  /** Console echo threshold; per-channel overrides win over the global level. */
  private consoleLevel: DiagLevel | 'silent';
  private readonly channelConsoleLevels = new Map<string, DiagLevel | 'silent'>();
  /** The ring: entries in log order, oldest first. Length <= ringCapacity. */
  private readonly ring: DiagEntry[] = [];

  constructor(opts: DiagLogOptions = {}) {
    this.ringCapacity = opts.ringCapacity ?? DEFAULT_RING_CAPACITY;
    if (!Number.isInteger(this.ringCapacity) || this.ringCapacity < 1) {
      throw new Error(`DiagLog ringCapacity must be an integer >= 1, got ${this.ringCapacity}`);
    }
    this.consoleLevel = opts.consoleLevel ?? DEFAULT_CONSOLE_LEVEL;
    this.consoleSink = opts.console ?? console;
    this.now = opts.now ?? ((): number => performance.now());
  }

  log(channel: string, level: DiagLevel, message: string, data?: unknown): void {
    const entry: DiagEntry = {
      timeMs: this.now(),
      channel,
      level,
      message,
      ...(data !== undefined ? { data: toJsonSafe(data) } : {}),
    };
    this.ring.push(entry);
    while (this.ring.length > this.ringCapacity) this.ring.shift();
    const threshold = this.channelConsoleLevels.get(channel) ?? this.consoleLevel;
    if (threshold !== 'silent' && LEVEL_RANK[level] >= LEVEL_RANK[threshold]) {
      if (data !== undefined) this.consoleSink[level](`[${channel}] ${message}`, data);
      else this.consoleSink[level](`[${channel}] ${message}`);
    }
  }

  debug(channel: string, message: string, data?: unknown): void {
    this.log(channel, 'debug', message, data);
  }

  info(channel: string, message: string, data?: unknown): void {
    this.log(channel, 'info', message, data);
  }

  warn(channel: string, message: string, data?: unknown): void {
    this.log(channel, 'warn', message, data);
  }

  error(channel: string, message: string, data?: unknown): void {
    this.log(channel, 'error', message, data);
  }

  /** Set the console echo threshold — globally, or for one channel (overriding the global level). */
  setConsoleLevel(level: DiagLevel | 'silent', channel?: string): void {
    if (channel !== undefined) this.channelConsoleLevels.set(channel, level);
    else this.consoleLevel = level;
  }

  /** All retained entries, oldest first (a defensive copy — the ring stays private). */
  entries(): readonly DiagEntry[] {
    return [...this.ring];
  }
}

/** The one app-wide logger instance — import this, not a per-module `new DiagLog()`. */
export const diag = new DiagLog();
