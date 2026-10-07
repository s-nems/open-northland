import { WEATHER_KINDS } from '../data/weather/types.js';
import { GROUND_WAVE_FILTER_SOURCE } from './ground-waves/ground-wave-filter.js';
import { DECOR_SHADOW_SOURCE } from './map-objects/decor-shadow-shader.js';
import { PALETTED_SPRITE_SOURCE } from './paletted-sprite/shader.js';
import {
  WORLD_MAGNIFICATIONS,
  type WorldMagnification,
  worldMagnifyModeNumber,
} from './pixel-art-registry.js';
import type { GlslProgramSource } from './program-source.js';
import { SHADED_DECOR_SOURCE, SHADED_TERRAIN_SOURCE, TINTED_TERRAIN_SOURCE } from './shading.js';
import { DEFAULT_SHADOW_STYLE, type ShadowStyle } from './shadow-style.js';
import { WEATHER_GRADE_SOURCE, WEATHER_VEIL_SOURCE } from './weather/atmosphere.js';
import { GROUND_REACTIONS_SOURCE } from './weather/ground-reactions.js';
import { precipitationSource } from './weather/precipitation-shader.js';
import { WORLD_BATCH_MAX_TEXTURES, worldBatchProgramSource } from './world-batch-shader.js';

/**
 * Batch texture limits the world batcher is compiled for: WebGL 2 guarantees 16 units; Pixi halves its
 * batch limit where the sampler if-chain fails to compile at a size, down to 8; desktop GL reports up
 * to 32, where the batcher caps its slots.
 */
const WORLD_BATCH_TEXTURE_LIMITS: readonly number[] = [8, 16, WORLD_BATCH_MAX_TEXTURES];

/** The programs every world compiles whatever its settings, beside the world batch variant they select. */
function fixedPrograms(): readonly GlslProgramSource[] {
  return [
    PALETTED_SPRITE_SOURCE,
    DECOR_SHADOW_SOURCE,
    SHADED_TERRAIN_SOURCE,
    SHADED_DECOR_SOURCE,
    TINTED_TERRAIN_SOURCE,
    WEATHER_GRADE_SOURCE,
    WEATHER_VEIL_SOURCE,
    GROUND_REACTIONS_SOURCE,
    GROUND_WAVE_FILTER_SOURCE,
    ...WEATHER_KINDS.map((kind) => precipitationSource(kind)),
  ];
}

/**
 * Every GL program the game compiles, in every variant its settings can select, so a check can read
 * or compile the whole set without a renderer. A program whose GLSL is generated lists one entry per
 * generated variant; a new program or variant joins this list in the commit that adds it.
 */
export function shaderCatalog(): readonly GlslProgramSource[] {
  const entries: GlslProgramSource[] = [];
  for (const maxTextures of WORLD_BATCH_TEXTURE_LIMITS) {
    for (const magnification of WORLD_MAGNIFICATIONS) {
      for (const shadow of [null, DEFAULT_SHADOW_STYLE]) {
        entries.push(worldBatchProgramSource(maxTextures, worldMagnifyModeNumber(magnification), shadow));
      }
    }
  }
  entries.push(...fixedPrograms());
  return entries;
}

/** What a world draws with: the one batch variant for the device's batch limit and the player's
 *  enhancement settings, and the fixed programs. */
export function bootShaderPrograms(
  maxBatchTextures: number,
  magnification: WorldMagnification,
  shadow: ShadowStyle | null,
): readonly GlslProgramSource[] {
  const slots = Math.min(maxBatchTextures, WORLD_BATCH_MAX_TEXTURES);
  return [worldBatchProgramSource(slots, worldMagnifyModeNumber(magnification), shadow), ...fixedPrograms()];
}
