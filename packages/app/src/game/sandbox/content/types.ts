import type { BuildingFootprint, ContentSet } from '@open-northland/data';

/** The optional content inputs a world builder resolves its `ContentSet` from; see `resolveWorldContent`. */
export interface WorldContentOptions {
  /** Extracted building footprints overlaid on the sandbox catalog (sim-affecting: collision,
   *  placement legality, walk-to-door). */
  readonly footprints?: ReadonlyMap<number, BuildingFootprint>;
  /** Localized good display names overlaid on the sandbox catalog. */
  readonly goodNames?: ReadonlyMap<string, string>;
  /** Real decoded content; when present it replaces the sandbox build entirely. */
  readonly content?: ContentSet;
}

/** Optional real-content overlays and extra catalog rows accepted by the sandbox assembler. */
export interface SandboxContentExtras {
  readonly buildings?: readonly { typeId: number; id: string; kind?: string }[];
  readonly jobs?: readonly { typeId: number; id: string }[];
  readonly tribes?: readonly { typeId: number; id: string }[];
  /** Extracted ground footprints replace hand-authored approximations wholesale when supplied. */
  readonly buildingFootprints?: ReadonlyMap<number, BuildingFootprint>;
  /** Localized display names keyed by the good's string id. */
  readonly goodNames?: ReadonlyMap<string, string>;
}
