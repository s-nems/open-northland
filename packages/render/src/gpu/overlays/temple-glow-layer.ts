import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Mesh, MeshGeometry, Shader, Sprite, type Texture, UniformGroup } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import {
  blessingTemplesOf,
  TEMPLE_MOTES,
  type TempleAuraPhases,
  type TempleMote,
  templeAuraPhases,
  templeGlowPulse,
  templeMote,
} from '../../data/scene/temple-glow.js';
import { readPosition } from '../../data/snapshot/index.js';
import { bakeGlow, GLOW_TEXTURE_SIZE } from '../lighting/glow-texture.js';
import { glProgramFor } from '../shaders/program-source.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { TEMPLE_AURA_SOURCE } from './temple-aura-shader.js';

export interface TempleGlowFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Whether the viewer sees a tile now; unset while the fog is off. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** Game seconds, so a pause holds the aura. */
  readonly seconds: number;
  /** Whether the motes rise; a far view drops them. */
  readonly motes: boolean;
}

/** The aura's strength at the top of its breath. Tuned by eye. */
const AURA_ALPHA = 0.3;
/** The wall line's and the rim's half-widths as shares of the drawn temple's. Tuned by eye. */
const WALL_SPREAD = 0.8;
const RIM_SPREAD = 2;
/** North-south over east-west radius of a patch of flat ground under the projection, as the art's
 *  platforms are drawn. Tuned by eye. */
const GROUND_SQUASH = 0.5;
/** Game seconds the aura takes to rise when a temple starts blessing and to die when it stops. */
const KINDLE_SECONDS = 1.2;
/** The longest step of the clock one frame kindles by, so a jump in time does not skip the rise. */
const KINDLE_STEP_SECONDS = 0.1;
/** A mote's colour, its largest width in world px, and its rise as a share of the temple's height. */
const MOTE_COLOUR = 0xbfeaff;
const MOTE_SIZE = 14;
const MOTE_RISE = 0.45;
const MOTE_ALPHA = 0.5;

const QUAD_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

/** One temple's aura and its motes. */
interface Aura {
  readonly ground: Mesh<MeshGeometry, Shader>;
  readonly uniforms: UniformGroup;
  /** The wall line's share of the rim, the crests' travel and the two drift angles the shader reads. */
  readonly values: Float32Array;
  readonly motes: Sprite[];
  /** 0 dark to 1 fully kindled. */
  kindled: number;
  /** Whether the temple blessed in view this frame. */
  blessing: boolean;
  /** The wall line's centre and half-width, and the drawn temple's height, in world px. */
  x: number;
  y: number;
  wall: number;
  height: number;
}

/**
 * The aura of each temple the viewer sees blessing, every tribe's alike, so a temple with no oil or a
 * wound reads at a glance: light leaving the wall line in crests on the ground under the house, and
 * motes rising before its walls over it. Our own effect; the original shows the blessing nowhere.
 * Temples are few, so every blessing one is walked and culled each frame, and each draws one quad.
 */
export class TempleGlowLayer {
  /** The light on the ground, under every sprite. */
  readonly container = new Container();
  /** The motes, over the sprites. */
  readonly motes = new Container();
  private readonly auras = new Map<number, Aura>();
  private readonly geometry = new MeshGeometry({
    positions: new Float32Array(QUAD_CORNERS),
    uvs: new Float32Array(QUAD_CORNERS),
    indices: new Uint32Array(QUAD_INDICES),
  });
  /** Baked when the first temple blesses. */
  private moteTexture: Texture | null = null;
  private lastSeconds: number | null = null;
  private readonly phases: TempleAuraPhases = { wave: 0, sway: 0, rays: 0 };
  private readonly mote: TempleMote = { across: 0, before: 0, rise: 0, alpha: 0, size: 0 };

  draw(frame: TempleGlowFrame): void {
    const elapsed = this.lastSeconds === null ? 0 : frame.seconds - this.lastSeconds;
    this.lastSeconds = frame.seconds;
    const kindling = Math.min(Math.max(elapsed, 0), KINDLE_STEP_SECONDS) / KINDLE_SECONDS;
    for (const aura of this.auras.values()) aura.blessing = false;
    for (const id of blessingTemplesOf(frame.snapshot)) this.place(frame, id);
    for (const [id, aura] of this.auras) {
      aura.kindled = aura.blessing
        ? Math.min(1, aura.kindled + kindling)
        : Math.max(0, aura.kindled - kindling);
      if (aura.kindled === 0 && !aura.blessing) {
        this.retire(aura);
        this.auras.delete(id);
        continue;
      }
      this.pose(aura, id, frame);
    }
  }

  /** Mark temple `id` blessing in view and take its drawn place. */
  private place(frame: TempleGlowFrame, id: number): void {
    const at = readPosition(entityById(frame.snapshot, id)?.components ?? {});
    if (at === null) return;
    const tileX = at.x / ONE;
    const tileY = at.y / ONE;
    const feet = tileToScreen(tileX, tileY);
    if (!isVisible(frame.viewport, feet.x, feet.y) || frame.fogVisible?.(tileX, tileY) === false) return;
    const bounds = frame.drawn.boundsOf(id);
    if (bounds === undefined) return;
    const aura = this.auraOf(id);
    // The wall line is an ellipse of flat ground whose front touches the drawn temple's lowest row.
    aura.wall = ((bounds.maxX - bounds.minX) / 2) * WALL_SPREAD;
    aura.x = (bounds.minX + bounds.maxX) / 2;
    aura.y = bounds.maxY - aura.wall * GROUND_SQUASH;
    aura.height = bounds.maxY - bounds.minY;
    aura.blessing = true;
  }

  private pose(aura: Aura, id: number, frame: TempleGlowFrame): void {
    const rim = (aura.wall / WALL_SPREAD) * RIM_SPREAD;
    const phases = templeAuraPhases(frame.seconds, id, this.phases);
    aura.values[0] = aura.wall / rim;
    aura.values[1] = phases.wave;
    aura.values[2] = phases.sway;
    aura.values[3] = phases.rays;
    aura.uniforms.update();
    aura.ground.position.set(aura.x, aura.y);
    aura.ground.scale.set(rim, rim * GROUND_SQUASH);
    aura.ground.alpha = AURA_ALPHA * aura.kindled * templeGlowPulse(frame.seconds, id);
    for (let i = 0; i < aura.motes.length; i++) {
      const sprite = aura.motes[i];
      if (sprite === undefined) continue;
      sprite.visible = frame.motes;
      if (!frame.motes) continue;
      const mote = templeMote(frame.seconds, id, i, this.mote);
      sprite.position.set(
        aura.x + mote.across * aura.wall,
        aura.y + mote.before * aura.wall * GROUND_SQUASH - mote.rise * aura.height * MOTE_RISE,
      );
      sprite.scale.set((MOTE_SIZE * mote.size) / GLOW_TEXTURE_SIZE);
      sprite.alpha = MOTE_ALPHA * mote.alpha * aura.kindled;
    }
  }

  private auraOf(id: number): Aura {
    let aura = this.auras.get(id);
    if (aura === undefined) {
      const values = new Float32Array(4);
      const uniforms = new UniformGroup({ uAura: { value: values, type: 'vec4<f32>' } });
      const shader = new Shader({
        glProgram: glProgramFor(TEMPLE_AURA_SOURCE),
        resources: { aura: uniforms },
      });
      const ground = new Mesh({ geometry: this.geometry, shader });
      ground.blendMode = 'add';
      this.container.addChild(ground);
      this.moteTexture ??= bakeGlow();
      const motes: Sprite[] = [];
      for (let i = 0; i < TEMPLE_MOTES; i++) {
        const mote = new Sprite(this.moteTexture);
        mote.anchor.set(0.5);
        mote.tint = MOTE_COLOUR;
        mote.blendMode = 'add';
        this.motes.addChild(mote);
        motes.push(mote);
      }
      aura = { ground, uniforms, values, motes, kindled: 0, blessing: false, x: 0, y: 0, wall: 0, height: 0 };
      this.auras.set(id, aura);
    }
    return aura;
  }

  private retire(aura: Aura): void {
    aura.ground.shader?.destroy();
    aura.ground.destroy();
    for (const mote of aura.motes) mote.destroy();
  }

  destroy(): void {
    for (const aura of this.auras.values()) this.retire(aura);
    this.auras.clear();
    this.container.destroy({ children: true });
    this.motes.destroy({ children: true });
    this.geometry.destroy(true);
    this.moteTexture?.destroy(true);
  }
}
