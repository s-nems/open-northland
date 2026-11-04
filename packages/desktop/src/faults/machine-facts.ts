/** Electron's `process.getSystemMemoryInfo()` counts in KiB. */
const KIB_PER_MIB = 1024;

export interface ShellMachine {
  /** An x64 build translated on an ARM64 machine: Rosetta on macOS, emulation on Windows. */
  readonly arm64Translation: boolean;
  /** `process.getSystemMemoryInfo()` when the page asks; macOS counts file cache as used, not free. */
  readonly memoryKib: { readonly total: number; readonly free: number };
}

/** The machine's state for a report's desktop facts, which the page receives as strings. */
export function machineFacts({ arm64Translation, memoryKib }: ShellMachine): Record<string, string> {
  return {
    arm64Translation: String(arm64Translation),
    systemMemoryTotalMib: String(Math.round(memoryKib.total / KIB_PER_MIB)),
    systemMemoryFreeMib: String(Math.round(memoryKib.free / KIB_PER_MIB)),
  };
}
