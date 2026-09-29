import { Texture, type TextureSource, UniformGroup } from 'pixi.js';
import { FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA } from '../../data/fog/index.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { WEATHER_SECTOR_NODES } from '../../data/weather/field.js';
import { WEATHER_NODES_PER_WORLD_X, WEATHER_NODES_PER_WORLD_Y } from '../../data/weather/precipitation.js';
import type { FogWashMask } from '../overlays/index.js';

/** Half-cell nodes per map cell along each axis. */
export const NODES_PER_CELL = 2;
const BYTE_MAX = 255;
const f = (value: number): string => value.toFixed(6);

/**
 * GLSL: the 0..1 share of weather kept at half-cell node `node` of a map `mapNodes` across. It fades to
 * none over the outermost sector, so weather never shows over the void past the edge; a zero map (none
 * set yet) keeps it all. Approximation: the fade width is tuned by eye.
 */
export const MAP_EDGE_GLSL = `
  float mapEdge(vec2 node, vec2 mapNodes) {
    if (mapNodes.x <= 0.0) return 1.0;
    vec2 inside = min(node, mapNodes - node);
    return smoothstep(0.0, ${f(WEATHER_SECTOR_NODES)}, inside.x) * smoothstep(0.0, ${f(WEATHER_SECTOR_NODES)}, inside.y);
  }
`;

/**
 * GLSL: `weatherReach(world)`, the share of airborne weather kept at a world px point: the map edge fade
 * times what the fog leaves, none over unexplored ground and all over explored ground. It samples the
 * fog wash's own texture, so the weather ends where the black begins.
 */
export const WEATHER_REACH_GLSL = `
  // Map size in half-cell nodes, zero before a map.
  uniform vec2 uReachMap;
  // Fog band's first texel corner in world px, band size in texels; a zero band means the fog is off.
  uniform vec4 uReachFogBand;
  // One over the fog texture's size in texels.
  uniform vec2 uReachFogTexel;
  uniform sampler2D uReachFog;
  ${MAP_EDGE_GLSL}
  float weatherReach(vec2 world) {
    float reach = mapEdge(world * vec2(${f(WEATHER_NODES_PER_WORLD_X)}, ${f(WEATHER_NODES_PER_WORLD_Y)}), uReachMap);
    if (uReachFogBand.z > 0.0 && reach > 0.0) {
      vec2 texel = clamp((world - uReachFogBand.xy) / vec2(${f(2 * TILE_HALF_W)}, ${f(TILE_HALF_H)}),
        vec2(0.5), uReachFogBand.zw - 0.5);
      float fog = textureLod(uReachFog, texel * uReachFogTexel, 0.0).a;
      reach *= 1.0 - smoothstep(${f(FOG_EXPLORED_ALPHA / BYTE_MAX)}, ${f(FOG_UNEXPLORED_ALPHA / BYTE_MAX)}, fog);
    }
    return reach;
  }
`;

type ReachUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uReachMap: Float32Array;
    readonly uReachFogBand: Float32Array;
    readonly uReachFogTexel: Float32Array;
  };
};

/** The uniforms and fog texture behind {@link WEATHER_REACH_GLSL}, shared by every sky shader. */
export class WeatherReach {
  readonly uniforms: ReachUniforms = new UniformGroup({
    uReachMap: { value: new Float32Array(2), type: 'vec2<f32>' },
    uReachFogBand: { value: new Float32Array(4), type: 'vec4<f32>' },
    uReachFogTexel: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
  }) as ReachUniforms;
  /** The texture bound as `uReachFog`; a stand-in while the fog is off, which the zero band never reads. */
  fogSource: TextureSource = Texture.WHITE.source;
  private fog: FogWashMask | null = null;

  /** The map's size in cells. */
  setMap(cellsWide: number, cellsHigh: number): void {
    const map = this.uniforms.uniforms.uReachMap;
    map[0] = cellsWide * NODES_PER_CELL;
    map[1] = cellsHigh * NODES_PER_CELL;
    this.uniforms.update();
  }

  /** The fog wash to follow; its fields are read again on every {@link update}. */
  watchFog(mask: FogWashMask): void {
    this.fog = mask;
  }

  /** Copies the fog's current band in; true when its texture changed and shaders must bind it again. */
  update(): boolean {
    const u = this.uniforms.uniforms;
    const mask = this.fog;
    const source = mask?.source ?? null;
    const band = u.uReachFogBand;
    if (mask === null || source === null) {
      band[2] = 0;
      band[3] = 0;
    } else {
      band[0] = mask.originX;
      band[1] = mask.originY;
      band[2] = mask.bandW;
      band[3] = mask.bandH;
      u.uReachFogTexel[0] = 1 / mask.texW;
      u.uReachFogTexel[1] = 1 / mask.texH;
    }
    this.uniforms.update();
    const next = source ?? Texture.WHITE.source;
    if (next === this.fogSource) return false;
    this.fogSource = next;
    return true;
  }
}
