import { Container, Sprite, Texture } from 'pixi.js';
import { fadeGrade } from '../../data/lighting/fade.js';
import { type LightGrade, NEUTRAL_GRADE } from '../../data/lighting/types.js';

/**
 * The scene grade: a map script's whole-map vertex tint drawn over everything the stage drew below
 * it, not only the ground the script could reach. A multiply quad carries the channels up to 1; the
 * channels above 1 add one quad at `OVERBRIGHT_SHARE` of their excess, about a multiply at mid-tones,
 * which cannot wash out. Screen sprites on the stage, never a `Filter` on the world layer (see
 * `post-fx.ts`).
 */

/** Share of a grade channel's excess over 1 the additive quad adds. Tuned by eye. */
const OVERBRIGHT_SHARE = 0.25;
const CHANNEL_MAX = 255;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

export interface SceneLightFrame {
  readonly screenW: number;
  readonly screenH: number;
  /** Game seconds, so a pause freezes the fade. */
  readonly gameSeconds: number;
}

function packColour(r: number, g: number, b: number): number {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * CHANNEL_MAX);
  return (channel(r) << RED_SHIFT) | (channel(g) << GREEN_SHIFT) | channel(b);
}

export class SceneLight {
  /** Mounted on the stage over the world and the weather, under the screen chrome and the HUD. */
  readonly container = new Container();
  private readonly shade = new Sprite(Texture.WHITE);
  private readonly overbright = new Sprite(Texture.WHITE);
  private target: LightGrade = NEUTRAL_GRADE;
  private readonly grade: [number, number, number] = [1, 1, 1];
  private lastSeconds: number | null = null;

  constructor() {
    this.container.label = 'scene-light';
    this.shade.blendMode = 'multiply';
    this.overbright.blendMode = 'add';
    this.container.addChild(this.shade, this.overbright);
    this.container.visible = false;
  }

  /** What the grade fades toward; null is daylight. `snap` takes it at once: the state a world was
   *  loaded in, which arrives after the first frame drew daylight. */
  setTarget(target: LightGrade | null, snap = false): void {
    this.target = target ?? NEUTRAL_GRADE;
    if (snap) {
      [this.grade[0], this.grade[1], this.grade[2]] = this.target;
    }
  }

  /** The grade drawn this frame, after the fade. */
  drawnGrade(): LightGrade {
    return this.grade;
  }

  /** Once per rendered frame, before the stage renders. */
  update(frame: SceneLightFrame): void {
    const last = this.lastSeconds;
    this.lastSeconds = frame.gameSeconds;
    fadeGrade(this.grade, this.target, last === null ? Infinity : frame.gameSeconds - last);
    const [r, g, b] = this.grade;
    if (r === 1 && g === 1 && b === 1) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const { screenW, screenH } = frame;
    // A brightening grade multiplies by white: only its additive quad draws.
    this.shade.visible = r < 1 || g < 1 || b < 1;
    if (this.shade.visible) {
      this.shade.tint = packColour(r, g, b);
      this.shade.setSize(screenW, screenH);
    }
    const over = packColour(
      (r - 1) * OVERBRIGHT_SHARE,
      (g - 1) * OVERBRIGHT_SHARE,
      (b - 1) * OVERBRIGHT_SHARE,
    );
    this.overbright.visible = over !== 0;
    if (over !== 0) {
      this.overbright.tint = over;
      this.overbright.setSize(screenW, screenH);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
