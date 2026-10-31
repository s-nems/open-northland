import type { EntryRef, KnowledgeBase } from '../../knowledge/model.js';
import type { GoodIconPainter } from '../good-art.js';

export type KnowledgeTab = 'goods' | 'buildings' | 'encyclopedia' | 'mechanics';
export type KnowledgeTree = Extract<KnowledgeTab, 'goods' | 'buildings'>;

/** Where a link, a contextual "?" or the menu sends the reader. */
export type KnowledgeTarget =
  | { readonly tab: KnowledgeTab }
  /** A tree with a card pinned and its entry open beside it; null shows the tree bare. */
  | { readonly tree: KnowledgeTree; readonly pin: EntryRef | null }
  | { readonly entry: EntryRef }
  | { readonly article: string }
  | { readonly calculator: string };

/** A house, good or trade as the seat stands now; a map's ban is told apart from an unmet requirement. */
export type KnowledgeStatus =
  | { readonly kind: 'available' }
  | { readonly kind: 'locked'; readonly missing: readonly string[] }
  | { readonly kind: 'mapForbidden' };

/** The running game, read when a tab renders, never per tick. Absent in the main menu. */
export interface KnowledgeSettlement {
  readonly tribe: number;
  status(kind: 'building' | 'good' | 'job', typeId: number): KnowledgeStatus;
  stock(goodType: number): number;
}

/** One looping preview: a fighter's blow or march, a worker at his trade, an animal. */
export type KnowledgeClip =
  | {
      readonly kind: 'job';
      readonly jobType: number;
      readonly tribe: number;
      readonly action: 'attack' | 'walk' | 'work';
    }
  | { readonly kind: 'animal'; readonly animalTribe: number; readonly action: 'attack' | 'walk' };

export interface KnowledgeMotion {
  /** Plays `clip` in `host` until the returned stop runs; false-like absence leaves `host` empty. */
  play(host: HTMLElement, clip: KnowledgeClip): (() => void) | null;
}

export interface KnowledgeArt {
  readonly goodIcon: GoodIconPainter;
  /** False leaves `image` empty and the caller shows no picture. */
  buildingThumb(image: HTMLImageElement, typeId: number, boxPx: number, tribe: number): boolean;
  animalPicture(image: HTMLImageElement, animalTribe: number, boxPx: number): boolean;
  /** Null where no sheet is available, so no block reserves room for a film. */
  readonly motion: KnowledgeMotion | null;
}

export interface KnowledgeDeps {
  readonly base: KnowledgeBase;
  readonly art: KnowledgeArt;
  readonly settlement: KnowledgeSettlement | null;
}

/** What every view of the window shares. `go` is the single navigation path, so Wróć sees every move. */
export interface KnowledgeContext extends KnowledgeDeps {
  /** The tribe the numbers are for: the seat's in a game, the reader's pick otherwise. */
  tribe(): number;
  go(target: KnowledgeTarget): void;
}

export interface KnowledgeView {
  readonly element: HTMLElement;
  /** Without a target the window stays where the reader left it during the session. */
  open(target?: KnowledgeTarget): void;
  /** Takes the Esc that belongs to the view (a pin, a search); false leaves it to the surface around it. */
  escape(): boolean;
  dispose(): void;
}
