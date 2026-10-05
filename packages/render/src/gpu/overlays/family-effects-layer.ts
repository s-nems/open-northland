import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { type Container, Sprite } from 'pixi.js';
import { aabbIntersects, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { SIGN_DEPTH_EPS, screenDepth } from '../../data/scene/index.js';
import { type ParticleRef, particleFrame } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { layeredLayerFor } from '../sprite-pool/layered-layers.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { worldBatched } from '../world-batcher.js';
import type { DoorBadge } from './door-badge.js';
import { retireUndrawn } from './retained-pool.js';

/** `give_birth` has the stork at 160 and birth at 235 in `atomicanimations.ini`.
 * The sim still compresses that sequence into MakingLove; align the flight's delivery with its birth.
 * One authored frame per tick and the house base anchor are presentation approximations. */
const STORK_BIRTH_FRAME = 75;

interface LoveClock {
  readonly elapsed: number;
  readonly duration: number;
}
interface Flight {
  readonly start: number;
  delivered: boolean;
}
interface FamilyFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  readonly doorBadges: readonly DoorBadge[];
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  readonly renderTime: number;
}

/** Authored heart plume and complete stork flight, including the departure after delivery.
 * Only visible homes and the bounded set of live flights are visited; no settler/world scan. */
export class FamilyEffectsLayer {
  private readonly nodes = new Map<string, Sprite>();
  private readonly seen = new Set<string>();
  private readonly visibleHomes = new Set<number>();
  private readonly flights = new Map<number, Flight>();
  private readonly births = new Map<number, number>();

  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  ingest(events: readonly SimEvent[], tick: number): void {
    if (this.sheet?.bindings.familyEffects?.stork === undefined) return;
    for (const ev of events) {
      if (ev.kind === 'settlerBorn') this.births.set(ev.entity, tick);
    }
  }

  draw(frame: FamilyFrame): void {
    this.seen.clear();
    this.visibleHomes.clear();
    for (const badge of frame.doorBadges) this.visibleHomes.add(badge.id);
    const binding = this.sheet?.bindings.familyEffects;
    if (binding !== undefined) {
      for (const badge of frame.doorBadges) {
        if (!badge.hearts || frame.drawn.anchorOf(badge.id) === undefined) continue;
        const love = entityById(frame.snapshot, badge.id)?.components.MakingLove as LoveClock | undefined;
        if (love === undefined) continue;
        const elapsed = love.elapsed + frame.renderTime - frame.snapshot.tick;
        if (binding.hearts !== undefined) {
          this.place(`hearts:${badge.id}`, badge.id, binding.hearts, elapsed, frame);
        }
        const untilBirth = love.duration - love.elapsed;
        if (binding.stork !== undefined && untilBirth <= STORK_BIRTH_FRAME) {
          const start = frame.snapshot.tick + untilBirth - STORK_BIRTH_FRAME;
          const flight = this.flights.get(badge.id);
          if (flight?.start !== start) this.flights.set(badge.id, { start, delivered: false });
        }
      }
      // A frame may batch past the approach. Birth events recover that flight without replaying arrival.
      for (const [baby, tick] of this.births) {
        const residence = entityById(frame.snapshot, baby)?.components.Residence as
          | { home: number }
          | undefined;
        if (residence === undefined) continue;
        const flight = this.flights.get(residence.home);
        if (flight !== undefined) flight.delivered = true;
        else
          this.flights.set(residence.home, {
            start: tick - STORK_BIRTH_FRAME,
            delivered: true,
          });
      }
      if (binding.stork !== undefined) this.drawFlights(frame, binding.stork);
    }
    this.births.clear();
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy());
  }

  private drawFlights(frame: FamilyFrame, stork: ParticleRef): void {
    for (const [home, flight] of this.flights) {
      const age = frame.renderTime - flight.start;
      const house = entityById(frame.snapshot, home);
      if (
        house === undefined ||
        particleFrame(stork, age) === undefined ||
        (!flight.delivered && house.components.MakingLove === undefined)
      ) {
        this.flights.delete(home);
        continue;
      }
      if (this.visibleHomes.has(home) && frame.drawn.anchorOf(home) !== undefined)
        this.place(`stork:${home}`, home, stork, age, frame);
    }
  }

  private place(key: string, home: number, ref: ParticleRef, age: number, frame: FamilyFrame): void {
    const bob = particleFrame(ref, age);
    const sheet = this.sheet;
    const position = entityById(frame.snapshot, home)?.components.Position as
      | { x: number; y: number }
      | undefined;
    if (bob === undefined || sheet === undefined || position === undefined) return;
    const resolved = layeredLayerFor(sheet, 'projectile', { layer: ref.layer, bob });
    if (resolved === null) return;
    const tileX = position.x / ONE;
    const tileY = position.y / ONE;
    const base = tileToScreen(tileX, tileY);
    const { scale, frame: cell } = resolved;
    // Stork offsets already contain its whole approach and departure: never centre each cropped frame.
    const x = base.x + cell.offsetX * scale;
    const y = base.y - terrainLiftAt(frame.elevation, tileX, tileY) + cell.offsetY * scale;
    if (
      !aabbIntersects(frame.viewport, {
        minX: x,
        minY: y,
        maxX: x + cell.width * scale,
        maxY: y + cell.height * scale,
      })
    )
      return;
    let node = this.nodes.get(key);
    if (node === undefined) {
      node = worldBatched(new Sprite());
      this.spriteLayer.addChild(node);
      this.nodes.set(key, node);
    }
    node.texture = this.textures.get(resolved.source, cell);
    node.scale.set(scale);
    node.position.set(x, y);
    node.zIndex = screenDepth(base.x, base.y, 'building') + SIGN_DEPTH_EPS;
    this.seen.add(key);
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    this.flights.clear();
    this.births.clear();
  }
}
