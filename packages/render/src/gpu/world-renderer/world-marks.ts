import { type SimEvent, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import type { Container, Texture } from 'pixi.js';
import type { FootfallGround } from '../../data/effects/index.js';
import type { Viewport } from '../../data/projection/index.js';
import { type ImportMarker, importMarkersOf } from '../../data/scene/import-markers.js';
import { OverheadColumn } from '../../data/scene/overhead-column.js';
import type { HouseBodyOf } from '../../data/scene/temple-glow.js';
import type { ElevationField, WaterField } from '../../data/terrain/index.js';
import type { ViewDetail } from '../../data/view-detail.js';
import { BloodLayer } from '../blood/layer.js';
import type { FallenBody } from '../building-damage/building-damage.js';
import { CollapseLayer, type WreckAnchor } from '../demolition/collapse-layer.js';
import { FamilyEffectsLayer } from '../overlays/family-effects-layer.js';
import { FootfallLayer } from '../overlays/footfall-layer.js';
import {
  AmuletArcLayer,
  BadgeLayer,
  type BuildingSignGfx,
  CombatEffectsLayer,
  type ConstructionSign,
  ConstructionSignLayer,
  type DoorBadge,
  DraughtGlowLayer,
  type ExperienceStar,
  type ExperienceStarGfx,
  ExperienceStarLayer,
  type GeometryDebugItem,
  GeometryDebugLayer,
  GroupNumberLayer,
  type ImportMarkerGfx,
  ImportMarkerLayer,
  type LifeHeart,
  LifeHeartLayer,
  type LostGoalMarker,
  type MapPing,
  MapPingLayer,
  type OrderMarker,
  OrderMarkerLayer,
  type RallyBanner,
  RallyBannerLayer,
  type SettlerBubble,
  type SettlerBubbleGfx,
  SettlerBubbleLayer,
  ShipWakeLayer,
  ShotLayer,
  StunStarLayer,
  TempleGlowLayer,
  WindTrailLayer,
} from '../overlays/index.js';
import { SelectionLayer } from '../selection/layer.js';
import type { RangeRing } from '../selection/range-ring.js';
import type { SelectionStyle } from '../selection/style.js';
import type { DrawnGeometry, DrawnWalker, ShipAfloat } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../textures/sprite-sheet.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { type CombatBonesGfx, NO_BUBBLES, NO_HEARTS, NO_SIGNS, NO_STARS } from './frame.js';
import type { WorldSceneLayers } from './painter-order.js';

/** The marks the world draws on its entities rather than as entities. */

const NO_MARKERS: readonly ImportMarker[] = [];
const NO_WALKERS: readonly DrawnWalker[] = [];

export type MarkSlots = Pick<
  WorldSceneLayers,
  | 'wakes'
  | 'templeGlow'
  | 'selection'
  | 'orderMarkers'
  | 'bones'
  | 'bloodGround'
  | 'footprints'
  | 'constructionSigns'
  | 'bubbles'
  | 'experienceStars'
  | 'hearts'
  | 'importMarkers'
  | 'groupNumbers'
  | 'rallyBanners'
  | 'mapPings'
  | 'geometryDebug'
>;

/** One frame's inputs for the marks. Every list is required: an empty one retires that mark's nodes. */
export interface WorldMarksFrame {
  readonly snapshot: WorldSnapshot;
  readonly zoom: number;
  /** What the view's scale leaves to draw; a dropped mark's list is read as empty. */
  readonly detail: ViewDetail;
  readonly selectionStyle?: SelectionStyle;
  readonly drawn: DrawnGeometry;
  readonly elevation: ElevationField;
  /** The sprite cull box the screen-bounded marks cull against. */
  readonly viewport: Viewport;
  readonly screenViewport?: Viewport;
  readonly fogVisible?: ((x: number, y: number) => boolean) | undefined;
  readonly fogExplored?: ((x: number, y: number) => boolean) | undefined;
  /** Interpolated render clock (`tick + alpha`) so fades, demolition and plumes glide at any frame rate. */
  readonly renderTime: number;
  /** The drawn ships, off the pool's culled draw list. */
  readonly ships: readonly ShipAfloat[];
  /** The drawn humans on the map ground, off the pool's culled draw list. */
  readonly walkers: readonly DrawnWalker[];
  /** Whether a road runs over a node. */
  readonly roadAt: (hx: number, hy: number) => boolean;
  /** The rain wetness 0..1 the ground shows at a node. */
  readonly wetAt: (hx: number, hy: number) => number;
  /** The map's water mask the wakes fade off. */
  readonly water: WaterField;
  readonly selection: ReadonlySet<number>;
  readonly flagged: ReadonlySet<number>;
  readonly focused: ReadonlySet<number>;
  readonly rangeRings: readonly RangeRing[];
  readonly orderMarkers: readonly OrderMarker[];
  readonly mapPings: readonly MapPing[];
  readonly rallyBanners: readonly RallyBanner[];
  /** Wall-clock seconds, the banner cloth's clock. */
  readonly clothSeconds: number;
  readonly lostGoals: readonly LostGoalMarker[];
  readonly lostGoalPulse: number;
  readonly doorBadges: readonly DoorBadge[];
  readonly constructionSigns: readonly ConstructionSign[];
  readonly settlerBubbles: readonly SettlerBubble[];
  readonly lifeHearts: readonly LifeHeart[];
  readonly experienceStars: readonly ExperienceStar[];
  /** Entity id → the numbers of its control groups; empty when the player turned the numbers off. */
  readonly groupNumbers: ReadonlyMap<number, readonly string[]>;
}

export class WorldMarks {
  private readonly wakes = new ShipWakeLayer();
  private readonly selection = new SelectionLayer();
  private readonly templeGlow = new TempleGlowLayer();
  private readonly orderMarkers = new OrderMarkerLayer();
  private readonly mapPings: MapPingLayer;
  private readonly rallyBanners: RallyBannerLayer;
  private readonly effects: CombatEffectsLayer;
  private readonly blood: BloodLayer;
  /** A razed building's reverse-construction transient. Its nodes live inside the depth-sorted sprite
   *  layer rather than a slot of their own, so fighters still occlude around the falling body. */
  private readonly collapses: CollapseLayer;
  /** A siege shot's stone, shadow, trail and landing smoke; in the depth-sorted sprite layer like the
   *  collapses. */
  private readonly shots: ShotLayer;
  /** Sign chains and garrison flags. Also inside the depth-sorted sprite layer, so a settler walking in
   *  front of a chain occludes it. */
  private readonly badges: BadgeLayer;
  private readonly familyEffects: FamilyEffectsLayer;
  private readonly draughtGlows: DraughtGlowLayer;
  private readonly amuletArcs: AmuletArcLayer;
  private readonly stunStars: StunStarLayer;
  private equipmentEffects = true;
  private readonly windTrails: WindTrailLayer;
  /** Prints in their own ground slot, dust in the depth-sorted sprite layer. */
  private readonly footfall: FootfallLayer;
  private readonly constructionSigns: ConstructionSignLayer;
  private readonly bubbles = new SettlerBubbleLayer();
  private readonly hearts = new LifeHeartLayer();
  private readonly experienceStars = new ExperienceStarLayer();
  private readonly importMarkers = new ImportMarkerLayer();
  /** The icons each person wears over his head this frame, which stack them in one column. */
  private readonly column = new OverheadColumn();
  private readonly groupNumbers = new GroupNumberLayer();
  private readonly geometryDebug = new GeometryDebugLayer();
  readonly slots: MarkSlots;

  constructor(
    spriteLayer: Container,
    private readonly textures: TextureCache,
    sheet: SpriteSheet | undefined,
    playerColourOf?: (player: number) => number,
    captureDamage?: (ref: number) => readonly FallenBody[] | undefined,
    wreckAnchor?: (ref: number) => WreckAnchor | undefined,
    mapPingPin?: Texture,
    rallyBanner?: Texture,
  ) {
    this.mapPings = new MapPingLayer(mapPingPin);
    this.rallyBanners = new RallyBannerLayer(rallyBanner);
    this.blood = new BloodLayer(spriteLayer);
    this.effects = new CombatEffectsLayer((sprite, id, groundY, lift) =>
      this.blood.surfaces.restore(sprite, id, groundY, lift),
    );
    this.blood.groundSurfaces = this.effects.groundContainer;
    this.collapses = new CollapseLayer(spriteLayer, textures, sheet, captureDamage, wreckAnchor);
    this.shots = new ShotLayer(spriteLayer, textures, sheet);
    this.familyEffects = new FamilyEffectsLayer(spriteLayer, textures, sheet);
    this.draughtGlows = new DraughtGlowLayer(spriteLayer);
    this.amuletArcs = new AmuletArcLayer(spriteLayer);
    this.stunStars = new StunStarLayer(spriteLayer);
    this.windTrails = new WindTrailLayer(spriteLayer);
    this.footfall = new FootfallLayer(spriteLayer, textures, sheet);
    this.badges = new BadgeLayer(spriteLayer, playerColourOf);
    this.constructionSigns = new ConstructionSignLayer(playerColourOf);
    this.slots = {
      wakes: this.wakes.container,
      templeGlow: this.templeGlow.container,
      selection: this.selection.container,
      orderMarkers: this.orderMarkers.container,
      bones: this.effects.groundContainer,
      bloodGround: this.blood.groundContainer,
      footprints: this.footfall.container,
      constructionSigns: this.constructionSigns.container,
      bubbles: this.bubbles.container,
      experienceStars: this.experienceStars.container,
      hearts: this.hearts.container,
      importMarkers: this.importMarkers.container,
      groupNumbers: this.groupNumbers.container,
      rallyBanners: this.rallyBanners.container,
      mapPings: this.mapPings.container,
      geometryDebug: this.geometryDebug.container,
    };
  }

  /** Fold this frame's sim events into the event-driven layers; `tick` is the integer sim tick they
   *  decay against. */
  ingest(events: readonly SimEvent[], tick: number, snapshot?: WorldSnapshot): void {
    this.blood.ingest(events, tick, snapshot);
    this.effects.ingest(events, tick);
    this.collapses.ingest(events, tick);
    this.shots.ingest(events, tick);
    this.familyEffects.ingest(events, tick);
    this.draughtGlows.ingest(events, tick);
  }

  /** Call once per map; `null` leaves every step without a mark. */
  setFootfallGround(ground: FootfallGround | null): void {
    this.footfall.setGround(ground);
  }

  setBloodEnabled(enabled: boolean): void {
    this.blood.setEnabled(enabled);
  }

  /** Good type → the colour a sip of it glows in; `null` shows no sip. */
  setDraughtGlowColours(colourOfGood: ReadonlyMap<number, number> | null): void {
    this.draughtGlows.setColours(colourOfGood);
  }

  setEquipmentEffects(shown: boolean): void {
    this.equipmentEffects = shown;
  }

  /** Good type → the colour of the arc round a carrier of that amulet; `null` draws none. */
  setAmuletArcColours(colourOfGood: ReadonlyMap<number, number> | null): void {
    this.amuletArcs.setColours(colourOfGood);
  }

  /** The goods whose live carrier trails wind as it walks; `null` trails none. */
  setWindTrailGoods(goods: ReadonlySet<number> | null): void {
    this.windTrails.setGoods(goods);
  }

  setHouseBodies(bodyOf: HouseBodyOf | null): void {
    this.templeGlow.setHouseBodies(bodyOf);
  }

  setBonesFade(fades: boolean): void {
    this.effects.setBonesFade(fades);
  }

  setBonesGfx(gfx: CombatBonesGfx | null): void {
    this.effects.setBonesGfx(
      gfx === null ? undefined : { ...gfx, scale: gfx.scale ?? 1, textures: this.textures },
    );
  }

  /** The debris a wrecked cart or catapult scatters over its ruin nodes; `null` draws the procedural planks. */
  setWreckGfx(gfx: CombatBonesGfx | null): void {
    this.effects.setWreckGfx(
      gfx === null ? undefined : { ...gfx, scale: gfx.scale ?? 1, textures: this.textures },
    );
  }

  /** `null` leaves the bubble layer drawing nothing. */
  setBubbleGfx(gfx: SettlerBubbleGfx | null): void {
    this.bubbles.setGfx(gfx === null ? undefined : { ...gfx, textures: this.textures });
  }

  /** `null` leaves the star layer drawing nothing. */
  setExperienceStarGfx(gfx: ExperienceStarGfx | null): void {
    this.experienceStars.setGfx(gfx === null ? undefined : { ...gfx, textures: this.textures });
  }

  /** `null` leaves the import-marker layer drawing nothing. */
  setImportMarkerGfx(gfx: ImportMarkerGfx | null): void {
    this.importMarkers.setGfx(gfx === null ? undefined : { ...gfx, textures: this.textures });
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
    this.wakes.draw(frame.ships, drawn, frame.water, renderTime);
    this.templeGlow.draw({
      snapshot: frame.snapshot,
      drawn,
      viewport,
      fogVisible: frame.fogVisible,
      seconds: renderTime / TICKS_PER_SECOND,
    });
    this.selection.draw(
      {
        snapshot: frame.snapshot,
        drawn,
        elevation,
        zoom: frame.zoom,
        selectionStyle: frame.selectionStyle,
      },
      frame.selection,
      frame.flagged,
      frame.rangeRings,
      frame.focused,
    );
    this.orderMarkers.draw(frame.orderMarkers, frame.lostGoals, frame.lostGoalPulse, elevation, viewport);
    this.mapPings.draw(frame.mapPings, elevation, viewport);
    this.rallyBanners.draw(frame.rallyBanners, elevation, viewport, frame.clothSeconds);
    this.effects.draw(frame);
    this.blood.draw(frame);
    this.collapses.draw(elevation, viewport, renderTime);
    this.shots.draw({ snapshot: frame.snapshot, drawn, elevation, viewport, renderTime });
    const detail = frame.detail;
    this.badges.draw(frame.doorBadges, elevation, viewport, renderTime, detail.buildingSigns);
    this.familyEffects.draw(frame);
    this.draughtGlows.draw({ drawn, viewport, renderTime });
    this.amuletArcs.draw({
      snapshot: frame.snapshot,
      walkers: this.equipmentEffects && detail.amuletArcs ? frame.walkers : NO_WALKERS,
      drawn,
      viewport,
      renderTime,
    });
    this.stunStars.draw({
      snapshot: frame.snapshot,
      walkers: detail.overheadIcons ? frame.walkers : NO_WALKERS,
      drawn,
      viewport,
      renderTime,
    });
    if (this.equipmentEffects && detail.windTrails)
      this.windTrails.draw({ snapshot: frame.snapshot, walkers: frame.walkers, drawn, viewport, renderTime });
    else this.windTrails.clear();
    this.footfall.draw({
      snapshot: frame.snapshot,
      walkers: detail.footfalls ? frame.walkers : NO_WALKERS,
      roadAt: frame.roadAt,
      wetAt: frame.wetAt,
      elevation,
      viewport,
      renderTime,
    });
    this.constructionSigns.draw(
      detail.buildingSigns ? frame.constructionSigns : NO_SIGNS,
      elevation,
      viewport,
    );
    const settlerBubbles = detail.overheadIcons ? frame.settlerBubbles : NO_BUBBLES;
    const lifeHearts = detail.overheadIcons ? frame.lifeHearts : NO_HEARTS;
    const experienceStars = detail.overheadIcons ? frame.experienceStars : NO_STARS;
    const column = this.column;
    column.clear();
    if (this.experienceStars.drawsStars) {
      for (const star of experienceStars) {
        if (star.weaponTier > 0) column.wear(star.id, 'weaponStar');
        if (star.jobTier > 0) column.wear(star.id, 'jobStar');
      }
    }
    for (const heart of lifeHearts) column.wear(heart.id, 'heart');
    if (this.bubbles.drawsBubbles) for (const bubble of settlerBubbles) column.wear(bubble.id, 'bubble');
    const exempt = this.importMarkers.exempt;
    const markers = exempt === undefined ? NO_MARKERS : importMarkersOf(frame.snapshot, exempt);
    this.bubbles.draw({ bubbles: settlerBubbles, drawn, elevation, column }, viewport);
    this.experienceStars.draw({ stars: experienceStars, drawn, elevation, column }, viewport);
    this.hearts.draw({ hearts: lifeHearts, drawn, elevation, column }, viewport);
    this.importMarkers.draw({ markers, drawn, elevation, column }, viewport);
    this.groupNumbers.draw(
      { snapshot: frame.snapshot, drawn, zoom: frame.zoom },
      frame.groupNumbers,
      viewport,
    );
  }

  collapseGroundCover(): readonly Viewport[] {
    return this.collapses.groundCover();
  }

  destroy(): void {
    this.wakes.destroy();
    this.templeGlow.destroy();
    this.selection.destroy();
    this.orderMarkers.destroy();
    this.mapPings.destroy();
    this.rallyBanners.destroy();
    this.effects.destroy();
    this.blood.destroy();
    this.collapses.destroy();
    this.shots.destroy();
    this.badges.destroy();
    this.familyEffects.destroy();
    this.draughtGlows.destroy();
    this.amuletArcs.destroy();
    this.stunStars.destroy();
    this.windTrails.destroy();
    this.footfall.destroy();
    this.constructionSigns.destroy();
    this.bubbles.destroy();
    this.hearts.destroy();
    this.experienceStars.destroy();
    this.importMarkers.destroy();
    this.groupNumbers.destroy();
    this.geometryDebug.destroy();
  }
}
