import type { BuildingFootprint } from '@open-northland/data';

/** Optional real-content overlays and extra catalog rows accepted by the sandbox assembler. */
export interface SandboxContentExtras {
  readonly buildings?: readonly { typeId: number; id: string; kind?: string }[];
  readonly jobs?: readonly { typeId: number; id: string }[];
  readonly tribes?: readonly { typeId: number; id: string }[];
  /** Extracted ground footprints replace clean-room approximations wholesale when supplied. */
  readonly buildingFootprints?: ReadonlyMap<number, BuildingFootprint>;
  /** Localized display names keyed by the good's string id. */
  readonly goodNames?: ReadonlyMap<string, string>;
}
