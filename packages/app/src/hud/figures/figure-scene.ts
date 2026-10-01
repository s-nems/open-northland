import {
  buildSpriteScene,
  createPresentationTrack,
  type DrawItem,
  type PresentationTrack,
  presentItem,
  type ResolvedLayer,
  type SpriteSheet,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';

const NO_ITEMS: ReadonlyMap<number, DrawItem> = new Map();

/**
 * The map's own presentation of a few chosen settlers and vehicles, for figures drawn outside the map:
 * their draw items, built once per snapshot and subject list, and a presentation track each, so motion,
 * atomics and gait play as they do in the world. A settler indoors or aboard a vehicle stands idle.
 */
export class FigureScene {
  private readonly tracks = new Map<number, PresentationTrack>();
  /** The items built for the last (snapshot, subjects) pair; frames between ticks reuse them. */
  private sceneFor: {
    snapshot: WorldSnapshot;
    subjects: readonly number[];
    refs: string;
    items: ReadonlyMap<number, DrawItem>;
  } | null = null;

  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly playerColourOf?: (player: number) => number,
  ) {}

  /** The subjects' settler and vehicle items; a subject the scene does not draw is missing. */
  items(snapshot: WorldSnapshot, subjects: readonly number[]): ReadonlyMap<number, DrawItem> {
    if (subjects.length === 0) return NO_ITEMS;
    const held = this.sceneFor;
    if (held?.snapshot === snapshot && held.subjects === subjects) return held.items;
    const refs = [...subjects].sort((a, b) => a - b).join(',');
    if (held?.snapshot === snapshot && held.refs === refs) {
      held.subjects = subjects;
      return held.items;
    }
    const items = new Map<number, DrawItem>();
    if (this.sheet !== undefined) {
      const scene = buildSpriteScene(snapshot, {
        playerColourOf: this.playerColourOf,
        keepIndoorSettlers: true,
        keepAboardRiders: true,
        onlyRefs: new Set(subjects),
      });
      for (const it of scene) if (it.kind === 'settler' || it.kind === 'vehicle') items.set(it.ref, it);
    }
    this.sceneFor = { snapshot, subjects, refs, items };
    return items;
  }

  /** `item`'s layers this frame; `alpha` is the frame's inter-tick fraction, as the map draws with. */
  layers(item: DrawItem, tick: number, alpha: number): readonly ResolvedLayer[] | null {
    if (this.sheet === undefined) return null;
    let track = this.tracks.get(item.ref);
    if (track === undefined) {
      track = createPresentationTrack(item.kind === 'vehicle' ? 'vehicle' : 'settler');
      this.tracks.set(item.ref, track);
    }
    return presentItem(track, item, tick, alpha, this.sheet);
  }

  /** Drop the tracks of the subjects no longer shown, so one shown again starts afresh. */
  keepOnly(shown: ReadonlySet<number>): void {
    for (const entity of this.tracks.keys()) if (!shown.has(entity)) this.tracks.delete(entity);
  }
}
