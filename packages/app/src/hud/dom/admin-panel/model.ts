import type { GoodIconPainter } from '../good-art.js';

/** The debug tools' tabs: drop things on the map, act on what stands there, change the world's rules,
 *  read what each computer seat thinks. */
export type AdminTab = 'spawn' | 'act' | 'world' | 'ai';

/** A per-spawn setting. Owner and health stand above every group; the rest show with a group whose
 *  tools apply them. */
export type AdminKnob = 'owner' | 'hitpoints' | 'weapon' | 'armor' | 'skills';

/** A man's professions: the basic ones a newcomer may take, or every one already learned. */
export type AdminSkills = 'basic' | 'all';

/** One armable tool; `key` is the controller's, unique across the panel. */
export interface AdminTool {
  readonly key: string;
  readonly label: string;
  /** The settings its spawn takes. */
  readonly knobs: readonly AdminKnob[];
  /** Shows the good's own icon on the tile. */
  readonly goodId?: string;
}

export interface AdminSpawnGroup {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
  readonly tools: readonly AdminTool[];
}

/** One option of an equipment setting. */
export interface AdminChoice {
  readonly value: number;
  readonly label: string;
  /** Shows the good's own icon on the option. */
  readonly goodId?: string;
}

export interface AdminAction {
  readonly key: string;
  readonly label: string;
  /** What the next click picks, as the row's second line. */
  readonly target: string;
  /** The action takes the health share field. */
  readonly percent?: boolean;
}

export interface AdminOwner {
  readonly player: number;
  /** The seat's number as the lobby shows it, written on the swatch. */
  readonly slot: number;
  /** The seat's team colour for the swatch. */
  readonly css: string;
  readonly name: string;
}

export type FogMapKey = 'off' | 'classic' | 'recon';

export interface AdminWorldState {
  readonly needs: boolean;
  /** Wells and hives may stand off grass. */
  readonly bioGround: boolean;
  /** Null without a fog read. */
  readonly fog: { readonly map: FogMapKey; readonly fogOfWar: boolean } | null;
  readonly geometry: boolean;
  readonly zoomOut: boolean;
  /** The clock's multiplier; null without a clock of the session's own. */
  readonly speed: number | null;
}

/** A plain debug table: an optional header row over rows of text cells. */
export interface AdminAiTable {
  readonly head: readonly string[] | null;
  readonly rows: readonly (readonly string[])[];
}

/** One computer seat's block in the AI tab. */
export interface AdminAiSeat {
  readonly title: string;
  /** Why some of the tables are missing, such as a map scan not taken yet; null when all are there. */
  readonly note: string | null;
  readonly tables: readonly AdminAiTable[];
}

export interface AdminPanelSpec {
  readonly owners: readonly AdminOwner[];
  readonly owner: number;
  readonly hitpoints: number;
  readonly weapons: readonly AdminChoice[];
  readonly weapon: number;
  readonly armors: readonly AdminChoice[];
  readonly armor: number;
  readonly skills: AdminSkills;
  readonly groups: readonly AdminSpawnGroup[];
  readonly actions: readonly AdminAction[];
  readonly healthPercent: number;
  readonly hasFog: boolean;
  /** The debug tempos; empty hides the row. */
  readonly speeds: readonly number[];
  readonly paintGood?: GoodIconPainter;
}

export interface AdminPanelHandlers {
  /** The panel opened (to refresh its world state) or closed. */
  readonly onOpen: (open: boolean) => void;
  /** The AI tab came into view (the panel open on it) or left it; it is refreshed only while shown. */
  readonly onAiView: (shown: boolean) => void;
  /** A tool's tile was pressed; the controller arms or disarms it. */
  readonly onTool: (key: string) => void;
  readonly onDisarm: () => void;
  readonly onOwner: (player: number) => void;
  readonly onHitpoints: (hitpoints: number) => void;
  readonly onWeapon: (weapon: number) => void;
  readonly onArmor: (armor: number) => void;
  readonly onSkills: (skills: AdminSkills) => void;
  readonly onHealthPercent: (percent: number) => void;
  readonly onNeeds: (enabled: boolean) => void;
  readonly onBioGround: (waived: boolean) => void;
  readonly onFogMap: (map: FogMapKey) => void;
  readonly onFogOfWar: (enabled: boolean) => void;
  readonly onGeometry: (enabled: boolean) => void;
  readonly onZoomOut: (unlocked: boolean) => void;
  readonly onSpeed: (multiplier: number) => void;
}

/** The armed tool as the footer names it. */
export interface AdminArmed {
  readonly key: string;
  readonly name: string;
  readonly hint: string;
}
