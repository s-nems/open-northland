import {
  type BLEND_MODES,
  BufferImageSource,
  Container,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import { darkenToAttackNight, fadeAttackNight } from '../../data/lighting/attack-night.js';
import { fadeGrade } from '../../data/lighting/fade.js';
import { nightLevel, shownGrade } from '../../data/lighting/grade.js';
import { LIGHT_LOOKS, type LightSite, lightShare } from '../../data/lighting/light-sites.js';
import { type LightGrade, NEUTRAL_GRADE } from '../../data/lighting/types.js';
import type { Camera } from '../../data/projection/iso.js';
import type { NightComposite } from '../world-renderer/offscreen-world.js';

/**
 * The scene grade: a map script's whole-map vertex tint drawn over everything the stage drew below
 * it, not only the ground the script could reach, in the look `data/lighting/grade.ts` shows it. By
 * day a multiply quad carries the channels up to 1; the channels above 1 add one quad at
 * `OVERBRIGHT_SHARE` of their excess, about a multiply at mid-tones, which cannot wash out. At night
 * the offscreen world composites instead (`world-renderer/offscreen-world.ts`): the unlit world
 * multiplies by a light map cleared to the grade, with a warm pool round each house and fire, and what
 * a light-bearer marked lit (`lighting/night-mask.ts`) by {@link NIGHT_LIT_COLOUR}, so the settlers
 * and the lower walls of the houses keep part of their daylight colours with no light on the ground
 * round a walker, and each fire shows a flame. A siege attack darkens the script's grade into the
 * attack night (`data/lighting/attack-night.ts`) before any of this, so it lights the same lamps.
 * Screen sprites, never a `Filter` on the world layer (see `world-renderer/post-fx.ts`).
 */

/** Share of a grade channel's excess over 1 the additive quad adds. Tuned by eye. */
const OVERBRIGHT_SHARE = 0.25;
/** The light map's share of the screen's device resolution: its pools are soft, so a linear upscale
 *  hides it. */
const LIGHT_MAP_SCALE = 0.5;
/** Approximation: a pool lies on the ground, flattened like the isometric floor. */
const POOL_SQUASH = 0.6;
/** A flame burns this far above the fire's feet, world px. */
const FLARE_HEIGHT_PX = 16;
/** The baked radial glow's size and falloff stops (radius share, alpha). */
const GLOW_TEXTURE_SIZE = 128;
const GLOW_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 0.75],
  [0.75, 0.25],
  [1, 0],
];
const CHANNEL_MAX = 255;
/** What a fully lit texel multiplies by at night: a warm lamplight, tuned by eye. */
const NIGHT_LIT_COLOUR: readonly [number, number, number] = [1, 0.94, 0.84];
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

export interface SceneLightFrame {
  readonly screenW: number;
  readonly screenH: number;
  /** Game seconds, so a pause freezes the fade and the flicker. */
  readonly gameSeconds: number;
  /** The main view's camera, after any device-pixel snap; places the lights. */
  readonly camera?: Camera;
  /** The lights on screen this frame. */
  readonly lights?: readonly LightSite[];
  /** Renders the light map; without it the night is drawn without lights. */
  readonly renderer?: Renderer;
  /** False draws a night as a flat grade, as the player's graphics settings may ask. */
  readonly dayNight?: boolean;
}

function packColour(r: number, g: number, b: number): number {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * CHANNEL_MAX);
  return (channel(r) << RED_SHIFT) | (channel(g) << GREEN_SHIFT) | channel(b);
}

/** The soft radial glow every light draws with: white, premultiplied, its alpha falling through
 *  {@link GLOW_STOPS}. */
function bakeGlow(): Texture {
  const data = new Uint8Array(GLOW_TEXTURE_SIZE * GLOW_TEXTURE_SIZE * 4);
  const centre = GLOW_TEXTURE_SIZE / 2;
  for (let y = 0; y < GLOW_TEXTURE_SIZE; y++) {
    for (let x = 0; x < GLOW_TEXTURE_SIZE; x++) {
      const at = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      const value = Math.round(glowAlpha(at) * CHANNEL_MAX);
      data.fill(value, (y * GLOW_TEXTURE_SIZE + x) * 4, (y * GLOW_TEXTURE_SIZE + x + 1) * 4);
    }
  }
  const source = new BufferImageSource({
    resource: data,
    width: GLOW_TEXTURE_SIZE,
    height: GLOW_TEXTURE_SIZE,
    alphaMode: 'premultiplied-alpha',
    scaleMode: 'linear',
  });
  return new Texture({ source });
}

/** {@link GLOW_STOPS} at radius share `at`, linear between stops and 0 past the last. */
function glowAlpha(at: number): number {
  for (let i = 1; i < GLOW_STOPS.length; i++) {
    const [from, fromAlpha] = GLOW_STOPS[i - 1] ?? [0, 0];
    const [to, toAlpha] = GLOW_STOPS[i] ?? [1, 0];
    if (at <= to) return fromAlpha + ((toAlpha - fromAlpha) * (at - from)) / (to - from);
  }
  return 0;
}

export class SceneLight {
  /** Mounted on the stage over the world and the weather, under the screen chrome and the HUD. */
  readonly container = new Container();
  private readonly shade = new Sprite(Texture.WHITE);
  private readonly overbright = new Sprite(Texture.WHITE);
  /** The light map's render root; never on the stage. Merged pools first, so a fire adds over them. */
  private readonly mapRoot = new Container();
  private readonly merged = new GlowSprites(this.mapRoot, 'max');
  private readonly added = new GlowSprites(this.mapRoot, 'add');
  private readonly flares = new GlowSprites(this.container, 'add');
  private map: RenderTexture | null = null;
  /** Baked when the first night asks for it. */
  private glow: Texture | null = null;
  private target: LightGrade = NEUTRAL_GRADE;
  /** The script's grade after the fade; {@link shown} is what draws. */
  private readonly grade: [number, number, number] = [1, 1, 1];
  /** {@link grade} darkened by the attack night, while it falls, stands or lifts. */
  private readonly darkened: [number, number, number] = [1, 1, 1];
  /** The grade the last frame lit by: {@link grade}, or {@link darkened} while the attack night shows. */
  private lit: LightGrade = this.grade;
  private readonly shown: [number, number, number] = [1, 1, 1];
  private readonly clearColor: [number, number, number, number] = [1, 1, 1, 1];
  private lastSeconds: number | null = null;
  /** Whether a siege attack runs, and the attack night's linear level fading toward it. */
  private attackOn = false;
  private attack = 0;
  /** This frame's night composite, while the night lights the world. */
  private night: NightComposite | null = null;
  /** {@link night}'s record, refilled each night frame. */
  private readonly composed: { light: Texture; readonly lit: readonly [number, number, number] } = {
    light: Texture.WHITE,
    lit: NIGHT_LIT_COLOUR,
  };

  constructor() {
    this.container.label = 'scene-light';
    this.shade.blendMode = 'multiply';
    this.overbright.blendMode = 'add';
    this.container.addChildAt(this.overbright, 0);
    this.container.addChildAt(this.shade, 0);
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

  /** Whether the attack night (`data/lighting/attack-night.ts`) falls over the scene or lifts. */
  setAttackNight(on: boolean): void {
    this.attackOn = on;
  }

  /** How strongly the night lights burn under the grade the last frame drew, 0 by day. */
  nightLevel(): number {
    return nightLevel(this.lit);
  }

  /** What the offscreen world composites this frame, null while no night lights it. */
  composite(): NightComposite | null {
    return this.night;
  }

  /** A save's picture renders the scene itself, without the composite: the night's light map then shades
   *  it as the day's grade does, until `false` puts the composite back. */
  shadeForPicture(on: boolean): void {
    if (this.night === null) return;
    this.shade.visible = on;
  }

  /** The grade drawn this frame, after the fade. */
  drawnGrade(): LightGrade {
    return this.shown;
  }

  /** Once per rendered frame, after the world placed its sprites and before the stage renders. */
  update(frame: SceneLightFrame): void {
    const last = this.lastSeconds;
    this.lastSeconds = frame.gameSeconds;
    const dt = last === null ? Infinity : frame.gameSeconds - last;
    fadeGrade(this.grade, this.target, dt);
    this.lit = this.grade;
    if (this.attackOn || this.attack > 0) {
      this.attack = fadeAttackNight(this.attack, this.attackOn, dt);
      this.lit = darkenToAttackNight(this.grade, this.attack, this.darkened);
    }
    shownGrade(this.lit, this.shown);
    const [r, g, b] = this.shown;
    const level = frame.dayNight === false ? 0 : nightLevel(this.lit);
    if (r === 1 && g === 1 && b === 1) {
      this.container.visible = false;
      this.night = null;
      return;
    }
    this.container.visible = true;
    const { screenW, screenH, renderer } = frame;
    // Always placed, so a step out of the night hides the last night's flames too.
    this.placeLights(frame, level);
    this.night = null;
    if (level > 0 && renderer !== undefined && frame.camera !== undefined) {
      const map = this.mapSized(renderer, screenW, screenH);
      this.clearColor[0] = Math.min(1, r);
      this.clearColor[1] = Math.min(1, g);
      this.clearColor[2] = Math.min(1, b);
      renderer.render({ container: this.mapRoot, target: map, clear: true, clearColor: this.clearColor });
      this.composed.light = map;
      this.night = this.composed;
      this.shade.texture = map;
      this.shade.tint = 0xffffff;
      this.shade.setSize(screenW, screenH);
      this.shade.visible = false;
    } else {
      // A brightening grade multiplies by white: only its additive quad draws.
      this.shade.visible = r < 1 || g < 1 || b < 1;
      if (this.shade.visible) {
        this.shade.texture = Texture.WHITE;
        this.shade.tint = packColour(r, g, b);
        this.shade.setSize(screenW, screenH);
      }
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
    this.mapRoot.destroy({ children: true });
    this.container.destroy({ children: true });
    this.map?.destroy(true);
    this.map = null;
    this.glow?.destroy(true);
    this.glow = null;
  }

  /** Place a pool in the light map per light, and a flame for a fire. */
  private placeLights(frame: SceneLightFrame, level: number): void {
    const { camera, lights, renderer } = frame;
    this.merged.begin();
    this.added.begin();
    this.flares.begin();
    if (level > 0 && camera !== undefined && lights !== undefined && renderer !== undefined) {
      this.glow ??= bakeGlow();
      const glow = this.glow;
      const zoom = camera.scale ?? 1;
      const perRadius = (2 * zoom) / GLOW_TEXTURE_SIZE;
      for (const light of lights) {
        const look = LIGHT_LOOKS[light.kind];
        const strength = lightShare(light.kind, light.seed, level, frame.gameSeconds);
        if (strength <= 0) continue;
        const x = camera.offsetX + light.x * zoom;
        const y = camera.offsetY + light.y * zoom;
        const pool = (look.merges ? this.merged : this.added).next(glow);
        pool.position.set(x, y);
        pool.scale.set(look.radius * perRadius, look.radius * perRadius * POOL_SQUASH);
        pool.tint = look.colour;
        pool.alpha = strength * look.strength;
        if (look.flareStrength > 0) {
          const flare = this.flares.next(glow);
          flare.position.set(x, y - FLARE_HEIGHT_PX * zoom);
          flare.scale.set(look.flareRadius * perRadius);
          flare.tint = look.colour;
          flare.alpha = strength * look.flareStrength;
        }
      }
    }
    this.merged.end();
    this.added.end();
    this.flares.end();
  }

  /** The light map for this screen, re-made only when the screen or its resolution changes. */
  private mapSized(renderer: Renderer, screenW: number, screenH: number): RenderTexture {
    const width = Math.max(1, Math.ceil(screenW));
    const height = Math.max(1, Math.ceil(screenH));
    const resolution = renderer.resolution * LIGHT_MAP_SCALE;
    const map = this.map;
    if (
      map !== null &&
      map.width === width &&
      map.height === height &&
      map.source.resolution === resolution
    ) {
      return map;
    }
    const next = RenderTexture.create({ width, height, resolution, antialias: false });
    next.source.scaleMode = 'linear';
    this.map = next;
    map?.destroy(true);
    return next;
  }
}

/** Pooled glow sprites in a container of their own, mounted where the caller asks, with one blend; a
 *  frame reuses them in order and hides the rest. */
class GlowSprites {
  readonly container = new Container();
  private readonly sprites: Sprite[] = [];
  count = 0;

  constructor(
    parent: Container,
    private readonly blend: BLEND_MODES,
  ) {
    parent.addChild(this.container);
  }

  begin(): void {
    this.count = 0;
  }

  next(glow: Texture): Sprite {
    let sprite = this.sprites[this.count];
    if (sprite === undefined) {
      sprite = new Sprite(glow);
      sprite.anchor.set(0.5);
      sprite.blendMode = this.blend;
      this.container.addChild(sprite);
      this.sprites.push(sprite);
    }
    sprite.visible = true;
    this.count++;
    return sprite;
  }

  end(): void {
    for (let i = this.count; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
  }
}
