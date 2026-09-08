import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import {
  BadgeLayer,
  type BuildingSignGfx,
  CollapseLayer,
  CombatEffectsLayer,
  type ConstructionSign,
  ConstructionSignLayer,
  DamageSmokeLayer,
  type DoorBadge,
  type GeometryDebugItem,
  GeometryDebugLayer,
  type LifeHeart,
  LifeHeartLayer,
  SelectionLayer,
  type SettlerBubble,
  type SettlerBubbleGfx,
  SettlerBubbleLayer,
  type WorkAreaRing,
} from '../overlays/index.js';
import type { DamagedBuilding, DrawnGeometry } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import type { CombatBonesGfx } from './frame.js';
import type { WorldSceneLayers } from './painter-order.js';

/** The marks the world draws on its entities rather than as entities. */

export type MarkSlots = Pick<
  WorldSceneLayers,
  | 'selection'
  | 'bones'
  | 'blood'
  | 'damageSmoke'
  | 'constructionSigns'
  | 'bubbles'
  | 'hearts'
  | 'geometryDebug'
>;

/** One frame's inputs for the marks. Every list is required: an empty one retires that mark's nodes. */
export interface WorldMarksFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  readonly elevation: ElevationField;
  /** The sprite cull box the screen-bounded marks cull against; damage smoke inherits the pool's cull
   *  through `damaged`, and the selection rings track the selected set instead. */
  readonly viewport: Viewport;
  /** Interpolated render clock (`tick + alpha`) so fades, sinks and plumes glide at any frame rate. */
  readonly renderTime: number;
  readonly damaged: readonly DamagedBuilding[];
  readonly selection: ReadonlySet<number>;
  readonly flagged: ReadonlySet<number>;
  readonly workAreas: readonly WorkAreaRing[];
  readonly doorBadges: readonly DoorBadge[];
  readonly constructionSigns: readonly ConstructionSign[];
  readonly settlerBubbles: readonly SettlerBubble[];
  readonly lifeHearts: readonly LifeHeart[];
}

export class WorldMarks {
  private readonly selection = new SelectionLayer();
  /** Two containers, because blood paints over the struck body while bones litter the ground under it. */
  private readonly effects = new CombatEffectsLayer();
  /** A razed building's sink-into-the-ground transient. Its nodes live inside the depth-sorted sprite
   *  layer rather than a slot of their own, so fighters still occlude around the falling body. */
  private readonly collapses: CollapseLayer;
  private readonly damageSmoke = new DamageSmokeLayer();
  /** Sign chains and garrison flags. Also inside the depth-sorted sprite layer, so a settler walking in
   *  front of a chain occludes it. */
  private readonly badges: BadgeLayer;
  private readonly constructionSigns: ConstructionSignLayer;
  private readonly bubbles = new SettlerBubbleLayer();
  private readonly hearts = new LifeHeartLayer();
  private readonly geometryDebug = new GeometryDebugLayer();
  readonly slots: MarkSlots;

  constructor(
    spriteLayer: Container,
    private readonly textures: TextureCache,
    sheet: SpriteSheet | undefined,
    playerColourOf?: (player: number) => number,
  ) {
    this.collapses = new CollapseLayer(spriteLayer, textures, sheet);
    this.badges = new BadgeLayer(spriteLayer, playerColourOf);
    this.constructionSigns = new ConstructionSignLayer(playerColourOf);
    this.slots = {
      selection: this.selection.container,
      bones: this.effects.groundContainer,
      blood: this.effects.overlayContainer,
      damageSmoke: this.damageSmoke.container,
      constructionSigns: this.constructionSigns.container,
      bubbles: this.bubbles.container,
      hearts: this.hearts.container,
      geometryDebug: this.geometryDebug.container,
    };
  }

  /** Fold this frame's sim events into the two event-driven layers; `tick` is the integer sim tick they
   *  decay against. */
  ingest(events: readonly SimEvent[], tick: number): void {
    this.effects.ingest(events, tick);
    this.collapses.ingest(events, tick);
  }

  setBonesGfx(gfx: CombatBonesGfx | null): void {
    this.effects.setBonesGfx(
      gfx === null ? undefined : { ...gfx, scale: gfx.scale ?? 1, textures: this.textures },
    );
  }

  /** `null` leaves the bubble layer drawing nothing. */
  setBubbleGfx(gfx: SettlerBubbleGfx | null): void {
    this.bubbles.setGfx(gfx === null ? undefined : { ...gfx, textures: this.textures });
  }

  /** Both sign layers read the one art set, so a door badge and a site stand cannot disagree. */
  setSignGfx(gfx: BuildingSignGfx | null): void {
    const signGfx = gfx === null ? undefined : { ...gfx, textures: this.textures };
    this.badges.setGfx(signGfx);
    this.constructionSigns.setGfx(signGfx);
  }

  setGeometryDebug(items: readonly GeometryDebugItem[] | null, elevation: ElevationField): void {
    this.geometryDebug.set(items, elevation);
  }

  draw(frame: WorldMarksFrame): void {
    const { drawn, elevation, viewport, renderTime } = frame;
    this.selection.draw(
      { snapshot: frame.snapshot, drawn, elevation },
      frame.selection,
      frame.flagged,
      frame.workAreas,
    );
    this.effects.draw(elevation, viewport, renderTime);
    this.collapses.draw(elevation, viewport, renderTime);
    this.damageSmoke.draw(frame.damaged, drawn, renderTime);
    this.badges.draw(frame.doorBadges, elevation, viewport, renderTime);
    this.constructionSigns.draw(frame.constructionSigns, elevation, viewport);
    this.bubbles.draw({ bubbles: frame.settlerBubbles, drawn, elevation }, viewport);
    this.hearts.draw({ hearts: frame.lifeHearts, drawn, elevation }, viewport);
  }

  destroy(): void {
    this.selection.destroy();
    this.effects.destroy();
    this.collapses.destroy();
    this.damageSmoke.destroy();
    this.badges.destroy();
    this.constructionSigns.destroy();
    this.bubbles.destroy();
    this.hearts.destroy();
    this.geometryDebug.destroy();
  }
}
