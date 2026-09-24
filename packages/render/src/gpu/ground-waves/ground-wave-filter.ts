import { Filter, GlProgram, type TextureSource, UniformGroup } from 'pixi.js';

/**
 * The ground-lift filter: each output pixel whose screen position the wave map covers reads the input
 * that many world pixels below it, so the ground under a wave rises by the map's value. The map is a
 * screen-sized render of the visible waves, lift in red and coverage in alpha.
 */

const VERTEX = `
  in vec2 aPosition;
  out vec2 vTextureCoord;
  out vec2 vScreen;
  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;
  void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    vScreen = position;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  }
`;

// A lift is a whole number of world pixels (the map's red byte); `uLiftScale` is the camera zoom. The
// screen lift rounds to whole device pixels so a fractional zoom never blends two ground rows.
const FRAGMENT = `
  in vec2 vTextureCoord;
  in highp vec2 vScreen;
  out vec4 finalColor;
  uniform sampler2D uTexture;
  uniform sampler2D uWaveMap;
  uniform highp vec4 uInputSize;
  uniform vec4 uInputClamp;
  uniform highp vec2 uScreenSize;
  uniform float uLiftScale;
  uniform float uResolution;
  void main(void) {
    vec4 wave = texture(uWaveMap, vScreen / uScreenSize);
    vec2 uv = vTextureCoord;
    if (wave.a > 0.5) {
      float devicePx = floor(floor(wave.r * 255.0 + 0.5) * uLiftScale * uResolution + 0.5);
      uv.y += devicePx / uResolution * uInputSize.w;
    }
    finalColor = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
  }
`;

export interface GroundWaveFilter {
  readonly filter: Filter;
  /** Point the filter at this frame's wave map, its screen size (CSS px), the camera zoom and the
   *  device pixels per CSS pixel. */
  bind(map: TextureSource, screenW: number, screenH: number, zoom: number, resolution: number): void;
}

export function makeGroundWaveFilter(map: TextureSource): GroundWaveFilter {
  const uniforms = new UniformGroup({
    uScreenSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uLiftScale: { value: 1, type: 'f32' },
    uResolution: { value: 1, type: 'f32' },
  });
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'ground-wave-filter' }),
    resources: { waveUniforms: uniforms, uWaveMap: map, uWaveMapSampler: map.style },
    // The filter's own default of 1 would redraw the ground at CSS resolution on a HiDPI screen.
    resolution: 'inherit',
  });
  return {
    filter,
    bind(next, screenW, screenH, zoom, resolution) {
      filter.resources.uWaveMap = next;
      filter.resources.uWaveMapSampler = next.style;
      const size = uniforms.uniforms.uScreenSize as Float32Array;
      size[0] = screenW;
      size[1] = screenH;
      uniforms.uniforms.uLiftScale = zoom;
      uniforms.uniforms.uResolution = resolution;
      uniforms.update();
    },
  };
}
