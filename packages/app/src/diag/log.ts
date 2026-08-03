/**
 * The app-wide diagnostics logger: named channels and levels over a level-filtered console sink and a
 * bounded ring the diagnostics bundle serializes. The core stays DOM-free so headless tests and node
 * imports work; browser-only facts live in `env-header.ts`.
 */

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error';

/** Severity order; a sink at level L passes entries ranked >= L. */
const LEVEL_RANK: Readonly<Record<DiagLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** One logged fact, JSON-serializable. */
export interface DiagEntry {
  /** Milliseconds from the injected clock, `performance.now()` by default. */
  readonly timeMs: number;
  readonly channel: string;
  readonly level: DiagLevel;
  readonly message: string;
  /** Extra structured context; an `Error` becomes a plain object at log time. */
  readonly data?: unknown;
}

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

/** `JSON.stringify` drops an `Error`'s fields, so it becomes a plain object; everything else passes through. */
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
  /** Entries oldest first; length <= ringCapacity. */
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

  setConsoleLevel(level: DiagLevel | 'silent', channel?: string): void {
    if (channel !== undefined) this.channelConsoleLevels.set(channel, level);
    else this.consoleLevel = level;
  }

  /** All retained entries, oldest first; a copy, so the ring stays private. */
  entries(): readonly DiagEntry[] {
    return [...this.ring];
  }
}

/** The one app-wide logger instance; do not construct a per-module `DiagLog`. */
export const diag = new DiagLog();
