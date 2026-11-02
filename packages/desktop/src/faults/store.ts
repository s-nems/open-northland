import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactHome } from './redact.js';

/** The shape `packages/app/src/view/platform/desktop-faults.ts` declares as `DesktopFault`. */
export interface ShellFault {
  readonly id: string;
  readonly trigger: FaultTrigger;
  readonly at: string;
  readonly reason: string;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  readonly stack: string | null;
  readonly url: string | null;
  /** Chromium's GPU feature status when the GPU process died (`app.getGPUFeatureStatus()`), else null. */
  readonly gpuStatus: Readonly<Record<string, string>> | null;
}
export type FaultTrigger = 'renderer-gone' | 'renderer-unresponsive' | 'gpu-gone' | 'error';
export type NewFault = Omit<ShellFault, 'id' | 'at'>;
export type FaultUpdate = Partial<Pick<ShellFault, 'durationMs' | 'stack'>>;

export interface FaultStore {
  /** Writes a new fault, then drops the oldest beyond `MAX_STORED_FAULTS`. */
  record(fault: NewFault): ShellFault;
  /** A no-op once the fault is cleared or dropped. */
  update(id: string, patch: FaultUpdate): void;
  /** Oldest first; unreadable files are skipped. */
  pending(): ShellFault[];
  /** Validates IPC input: an array of fault ids. */
  clear(ids: unknown): void;
}

const FAULT_FILE_VERSION = 2;
const FAULT_ID_BYTES = 16;
const FAULT_ID = /^[0-9a-f]{32}$/;
const FAULT_SUFFIX = '.json';
const STAGED_SUFFIX = '.tmp';
const TRIGGERS = {
  'renderer-gone': true,
  'renderer-unresponsive': true,
  'gpu-gone': true,
  error: true,
} satisfies Record<FaultTrigger, true>;

/** The faults are local, so the oldest beyond this count are dropped rather than kept. */
export const MAX_STORED_FAULTS = 20;
/** One page call clears at most what a few `pending()` answers held. */
const MAX_CLEARED_IDS = 100;
/** The report wire contract's stack limit. */
const MAX_STACK_CHARS = 16_000;
const MAX_URL_CHARS = 2048;
const MAX_REASON_CHARS = 200;
/** Electron's status has about twenty features, each a short state name. */
const MAX_GPU_STATUS_KEYS = 64;
const MAX_GPU_STATUS_CHARS = 64;
/** Above a clipped fault even with every character JSON-escaped; a larger file is not one of ours. */
const MAX_FAULT_FILE_BYTES = 128 * 1024;

function clip(text: string | null, limit: number, home: string): string | null {
  return text === null ? null : redactHome(text, home).slice(0, limit);
}

function isCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}
function isText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isGpuStatus(value: unknown): value is Readonly<Record<string, string>> | null {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_GPU_STATUS_KEYS &&
    entries.every(([key, state]) => key.length <= MAX_GPU_STATUS_CHARS && typeof state === 'string')
  );
}

/** Anything but this version's exact shape, under the id its file name carries, reads as absent. */
function parseFault(raw: unknown, id: string): ShellFault | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const { trigger, at, reason, exitCode, durationMs, stack, url, gpuStatus } = record;
  if (
    record.version !== FAULT_FILE_VERSION ||
    record.id !== id ||
    typeof trigger !== 'string' ||
    !Object.hasOwn(TRIGGERS, trigger) ||
    typeof at !== 'string' ||
    typeof reason !== 'string' ||
    !isCount(exitCode) ||
    !isCount(durationMs) ||
    !isText(stack) ||
    !isText(url) ||
    !isGpuStatus(gpuStatus)
  ) {
    return undefined;
  }
  return { id, trigger: trigger as FaultTrigger, at, reason, exitCode, durationMs, stack, url, gpuStatus };
}

function parseFaultIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_CLEARED_IDS) throw new Error('Invalid fault ids');
  return raw.map((id: unknown) => {
    if (typeof id !== 'string' || !FAULT_ID.test(id)) throw new Error('Invalid fault id');
    return id;
  });
}

/**
 * One JSON file per fault under `root`, written beside it and renamed into place, so a file is either
 * whole or absent. Synchronous: a main-process error may be the last thing the process does. Every
 * text field is clipped and has the user's home directory replaced before it is written.
 */
export function createFaultStore(root: string, home: string, now: () => Date = () => new Date()): FaultStore {
  const fileOf = (id: string): string => join(root, `${id}${FAULT_SUFFIX}`);
  const write = (fault: ShellFault): void => {
    mkdirSync(root, { recursive: true });
    const file = fileOf(fault.id);
    const staged = `${file}${STAGED_SUFFIX}`;
    writeFileSync(staged, JSON.stringify({ version: FAULT_FILE_VERSION, ...fault }));
    renameSync(staged, file);
  };
  const read = (id: string): ShellFault | undefined => {
    try {
      const file = fileOf(id);
      if (statSync(file).size > MAX_FAULT_FILE_BYTES) return undefined;
      return parseFault(JSON.parse(readFileSync(file, 'utf8')), id);
    } catch {
      return undefined;
    }
  };
  const entries = (): string[] => {
    try {
      return readdirSync(root);
    } catch {
      return [];
    }
  };
  /** The stored faults oldest first, and every other entry: staged leftovers and unreadable files. */
  const scan = (): { readonly faults: ShellFault[]; readonly strays: string[] } => {
    const faults: ShellFault[] = [];
    const strays: string[] = [];
    for (const name of entries()) {
      const id = name.endsWith(FAULT_SUFFIX) ? name.slice(0, -FAULT_SUFFIX.length) : '';
      const fault = FAULT_ID.test(id) ? read(id) : undefined;
      if (fault === undefined) strays.push(name);
      else faults.push(fault);
    }
    faults.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1));
    return { faults, strays };
  };
  const clipped = (fault: ShellFault): ShellFault => ({
    ...fault,
    reason: clip(fault.reason, MAX_REASON_CHARS, home) ?? '',
    stack: clip(fault.stack, MAX_STACK_CHARS, home),
    url: clip(fault.url, MAX_URL_CHARS, home),
    gpuStatus:
      fault.gpuStatus === null
        ? null
        : Object.fromEntries(
            Object.entries(fault.gpuStatus)
              .slice(0, MAX_GPU_STATUS_KEYS)
              .map(([key, state]) => [
                key.slice(0, MAX_GPU_STATUS_CHARS),
                state.slice(0, MAX_GPU_STATUS_CHARS),
              ]),
          ),
  });

  return {
    record(fault) {
      const stored = clipped({
        ...fault,
        id: randomBytes(FAULT_ID_BYTES).toString('hex'),
        at: now().toISOString(),
      });
      write(stored);
      const { faults, strays } = scan();
      const dropped = faults.slice(0, Math.max(0, faults.length - MAX_STORED_FAULTS));
      for (const name of [...strays, ...dropped.map((old) => `${old.id}${FAULT_SUFFIX}`)])
        rmSync(join(root, name), { force: true, recursive: true });
      return stored;
    },
    update(id, patch) {
      const fault = read(id);
      if (fault !== undefined) write(clipped({ ...fault, ...patch }));
    },
    pending() {
      return scan().faults;
    },
    clear(ids) {
      for (const id of parseFaultIds(ids)) rmSync(fileOf(id), { force: true });
    },
  };
}
