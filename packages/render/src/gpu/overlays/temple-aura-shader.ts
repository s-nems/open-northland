import type { GlslProgramSource } from '../shaders/program-source.js';

/** Crests on the ground between the walls and the rim at once. */
const WAVES = 2;
/** How sharply a crest stands out of the water between two: the power its cosine is raised to. */
const CREST_SHARPNESS = 2.5;
/** How fast the light hugging the walls dies with the reach, and the rays standing in it. */
const HALO_FALLOFF = 3.2;
const RAY_FALLOFF = 2.2;
/** How far the wall line and the crests sway from a true ellipse, as a share of the reach. */
const SWAY_WIDE = 0.03;
const SWAY_FINE = 0.015;
/** The shares of the three lights in the picture. */
const HALO_SHARE = 0.6;
const WAVE_SHARE = 0.5;
const RAY_SHARE = 0.7;
/** Near white at the walls, a deeper blue at the rim: added over green grass, a pale rim reads yellow. */
const WALL_COLOUR = 'vec3(0.5, 0.72, 1.0)';
const RIM_COLOUR = 'vec3(0.12, 0.32, 1.0)';

const float = (value: number): string => value.toFixed(3);

/**
 * A temple's blessing on the ground: light hugging the wall line, crests leaving it for the rim and
 * slow rays turning in it, all added over the ground. The quad spans the rim's disc with `aUV` in
 * -1..1; the house drawn over it hides the middle, so the light shows leaving its walls. Our own
 * look, tuned by eye.
 */
export const TEMPLE_AURA_SOURCE: GlslProgramSource = {
  name: 'temple-aura',
  vertex: `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
out vec2 vUV;
out vec4 vColour;
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vColour = uColor * uWorldColorAlpha;
}`,
  fragment: `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColour;
// The wall line's share of the rim radius, the crests' travel in 0..1, two drift angles in radians.
uniform vec4 uAura;
out vec4 finalColor;
const float TAU = 6.2831853;
void main() {
  float radius = length(vUV);
  float angle = atan(vUV.y, vUV.x);
  float sway = ${float(SWAY_WIDE)} * sin(angle * 3.0 + uAura.z) + ${float(SWAY_FINE)} * sin(angle * 7.0 - uAura.w);
  // 0 on the wall line, 1 on the rim.
  float reach = (radius - uAura.x) / (1.0 - uAura.x) + sway;
  float outside = max(reach, 0.0);
  float fromWalls = smoothstep(-0.45, 0.0, reach);
  float toRim = 1.0 - smoothstep(0.55, 1.0, reach);
  float halo = exp(-outside * ${float(HALO_FALLOFF)}) * fromWalls;
  float crest = pow(0.5 + 0.5 * cos(TAU * (outside * ${float(WAVES)} - uAura.y)), ${float(CREST_SHARPNESS)});
  float waves = crest * toRim * toRim * smoothstep(0.0, 0.12, reach);
  float turn = 0.5 + 0.5 * sin(angle * 23.0 + uAura.w) * sin(angle * 9.0 - uAura.z);
  float rays = turn * turn * turn * exp(-outside * ${float(RAY_FALLOFF)}) * fromWalls;
  float light = (halo * ${float(HALO_SHARE)} + waves * ${float(WAVE_SHARE)} + rays * ${float(RAY_SHARE)})
    * (1.0 - smoothstep(0.92, 1.0, radius));
  vec3 colour = mix(${WALL_COLOUR}, ${RIM_COLOUR}, clamp(reach, 0.0, 1.0));
  finalColor = vec4(colour * light, light) * vColour;
}`,
};
