import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import { isVisible, ONE, tileToScreenX, tileToScreenY, type Viewport } from '../../data/projection/index.js';
import {
  blessingTemplesOf,
  type TempleAuraPhases,
  templeAuraPhases,
  templeGlowPulse,
} from '../../data/scene/temple-glow.js';
import { readPosition } from '../../data/snapshot/index.js';
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
}

/** The aura's strength at the top of its breath. Tuned by eye. */
const AURA_ALPHA = 0.22;
/** The wall line's and the rim's half-widths as shares of the drawn temple's. Tuned by eye. */
const WALL_SPREAD = 0.8;
const RIM_SPREAD = 2.3;
/** North-south over east-west radius of a patch of flat ground under the projection, as the art's
 *  platforms are drawn. Tuned by eye. */
const GROUND_SQUASH = 0.5;
/** Game seconds the aura takes to rise when a temple starts blessing and to die when it stops. */
const KINDLE_SECONDS = 1.2;
/** The longest step of the clock one frame kindles by, so a jump in time does not skip the rise. */
const KINDLE_STEP_SECONDS = 0.1;

const QUAD_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

/** One temple's aura. */
interface Aura {
  readonly id: number;
  readonly ground: Mesh<MeshGeometry, Shader>;
  readonly uniforms: UniformGroup;
  /** The wall line's share of the rim, the crests' travel and the two drift angles the shader reads. */
  readonly values: Float32Array;
  /** 0 dark to 1 fully kindled. */
  kindled: number;
  /** Whether the viewer saw the temple blessing this frame. */
  blessing: boolean;
  /** The wall line's centre and half-width in world px. */
  x: number;
  y: number;
  wall: number;
}

/**
 * The aura of each temple the viewer sees blessing, every tribe's alike, so a temple with no oil or a
 * wound reads at a glance: light leaving the wall line in crests on the ground under the house.
 * Our own effect; the original shows the blessing nowhere.
 * An aura rises when its temple starts blessing and dies when it stops; one the viewer comes upon
 * already blessing shows whole, and one that leaves sight goes at once.
 * Every blessing temple is walked and culled each frame, off the index kept per change; each seen one
 * draws one quad.
 */
export class TempleGlowLayer {
  readonly container = new Container();
  private readonly auras = new Map<number, Aura>();
  private readonly geometry = new MeshGeometry({
    positions: new Float32Array(QUAD_CORNERS),
    uvs: new Float32Array(QUAD_CORNERS),
    indices: new Uint32Array(QUAD_INDICES),
  });
  private lastSeconds: number | null = null;
  /** The temples that blessed last frame, seen or not, and the set the next frame fills. */
  private blessed = new Set<number>();
  private spare = new Set<number>();
  private readonly phases: TempleAuraPhases = { wave: 0, sway: 0, rays: 0 };

  draw(frame: TempleGlowFrame): void {
    const first = this.lastSeconds === null;
    const elapsed = this.lastSeconds === null ? 0 : frame.seconds - this.lastSeconds;
    this.lastSeconds = frame.seconds;
    const kindling = Math.min(Math.max(elapsed, 0), KINDLE_STEP_SECONDS) / KINDLE_SECONDS;
    const before = this.blessed;
    const now = this.spare;
    now.clear();
    for (const aura of this.auras.values()) aura.blessing = false;
    for (const id of blessingTemplesOf(frame.snapshot)) {
      now.add(id);
      this.place(frame, id, first || before.has(id));
    }
    for (const aura of this.auras.values()) {
      if (aura.blessing) {
        aura.kindled = Math.min(1, aura.kindled + kindling);
      } else {
        aura.kindled = now.has(aura.id) ? 0 : Math.max(0, aura.kindled - kindling);
        if (aura.kindled === 0) {
          this.retire(aura);
          this.auras.delete(aura.id);
          continue;
        }
      }
      this.pose(aura, frame);
    }
    this.blessed = now;
    this.spare = before;
  }

  /** Mark temple `id` blessing in view and take its drawn place; a new aura of a temple that blessed
   *  `already` starts whole. */
  private place(frame: TempleGlowFrame, id: number, already: boolean): void {
    const at = readPosition(entityById(frame.snapshot, id)?.components ?? {});
    if (at === null) return;
    const tileX = at.x / ONE;
    const tileY = at.y / ONE;
    const feetX = tileToScreenX(tileX, tileY);
    const feetY = tileToScreenY(tileY);
    if (!isVisible(frame.viewport, feetX, feetY) || frame.fogVisible?.(tileX, tileY) === false) return;
    const bounds = frame.drawn.boundsOf(id);
    if (bounds === undefined) return;
    const aura = this.auraOf(id, already);
    // The wall line is an ellipse of flat ground whose front touches the drawn temple's lowest row.
    aura.wall = ((bounds.maxX - bounds.minX) / 2) * WALL_SPREAD;
    aura.x = (bounds.minX + bounds.maxX) / 2;
    aura.y = bounds.maxY - aura.wall * GROUND_SQUASH;
    aura.blessing = true;
  }

  private pose(aura: Aura, frame: TempleGlowFrame): void {
    const rim = (aura.wall / WALL_SPREAD) * RIM_SPREAD;
    const phases = templeAuraPhases(frame.seconds, aura.id, this.phases);
    aura.values[0] = aura.wall / rim;
    aura.values[1] = phases.wave;
    aura.values[2] = phases.sway;
    aura.values[3] = phases.rays;
    aura.uniforms.update();
    aura.ground.position.set(aura.x, aura.y);
    aura.ground.scale.set(rim, rim * GROUND_SQUASH);
    aura.ground.alpha = AURA_ALPHA * aura.kindled * templeGlowPulse(frame.seconds, aura.id);
  }

  private auraOf(id: number, whole: boolean): Aura {
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
      aura = { id, ground, uniforms, values, kindled: whole ? 1 : 0, blessing: false, x: 0, y: 0, wall: 0 };
      this.auras.set(id, aura);
    }
    return aura;
  }

  private retire(aura: Aura): void {
    aura.ground.shader?.destroy();
    aura.ground.destroy();
  }

  destroy(): void {
    for (const aura of this.auras.values()) this.retire(aura);
    this.auras.clear();
    this.container.destroy({ children: true });
    this.geometry.destroy(true);
  }
}
