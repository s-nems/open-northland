import { BLOOD_LIFETIME_TICKS } from '../data/effects/blood.js';

/** Local splats share the sprite's coverage, lighting and painter order. No additional texture taps. */
export const BLOOD_SURFACE_GLSL = /* glsl */ `
vec3 surfaceSpot(vec3 colour, vec2 px, vec2 size, float packed, float clock, float upright) {
  float shape = floor(packed / 65536.0);
  float radius = mod(shape, 16.0);
  if (radius < 1.0 || clock < 1.0) return colour;
  float age = clock <= 17.0 ? clock - 1.0 : 16.0 + (clock - 17.0) * 5.0;
  float dry = smoothstep(48.0, 480.0, age);
  float opacity = 0.9 * (1.0 - smoothstep(${BLOOD_LIFETIME_TICKS * 0.6}.0, ${BLOOD_LIFETIME_TICKS}.0, age));
  vec2 centre = vec2(mod(packed, 256.0), mod(floor(packed / 256.0), 256.0)) / 255.0 * size;
  float turn = floor(shape / 16.0);
  // Sixteen directions on a normalised diamond avoid per-fragment trigonometry.
  vec2 direction = normalize(abs(mod(vec2(turn, turn + 12.0), 16.0) - 8.0) - 4.0);
  vec2 delta = (px - centre) / radius;
  vec2 along = vec2(dot(delta, direction), dot(delta, vec2(-direction.y, direction.x)));
  float grain = bloodHash(px + centre);
  float edge = length(along / vec2(1.1, 0.8));
  float blot = 1.0 - smoothstep(0.48, 1.05, edge + (grain - 0.5) * 0.55);
  // Small forward satellites retain the strike direction instead of a uniform ring of spray.
  float spray = step(0.88, grain) *
    (1.0 - smoothstep(0.65, 1.65, length((along - vec2(0.6, 0.0)) / vec2(1.25, 0.65))));
  float run = upright * (0.65 + fract(centre.x * 0.13 + centre.y * 0.37) * 0.7);
  float trail = (1.0 - smoothstep(0.08, 0.23, abs(delta.x - 0.12))) *
    step(0.0, delta.y) * (1.0 - smoothstep(0.2, 0.35 + run, delta.y));
  float mask = max(blot, max(spray * 0.6, trail * upright * 0.8));
  float light = dot(colour, vec3(0.25, 0.6, 0.15));
  vec3 pigment = mix(vec3(0.46, 0.015, 0.022), vec3(0.235, 0.033, 0.024), dry);
  pigment *= 0.65 + light * 0.7;
  // A tiny wet highlight disappears as that particular patch dries.
  float glint = (1.0 - smoothstep(0.0, 0.24, length(delta - vec2(-0.2, -0.25)))) * (1.0 - dry);
  pigment += vec3(0.09, 0.035, 0.026) * glint;
  return mix(colour, pigment, mask * opacity);
}
vec3 splashBlood(vec3 colour, vec2 uv, vec2 size, vec4 splashes) {
  vec2 px = uv * size;
  float ages = abs(splashes.w);
  float upright = splashes.w < 0.0 ? 1.0 : 0.0;
  // One procedural body, with a hard cap; unused slots stop before any shape work.
  int count = splashes.z > 0.0 ? 3 : splashes.y > 0.0 ? 2 : 1;
  float bytePlace = 1.0;
  for (int i = 0; i < 3; i++) {
    if (i >= count) break;
    float clock = mod(floor(ages / bytePlace), 256.0);
    colour = surfaceSpot(colour, px, size, splashes[i], clock, upright);
    bytePlace *= 256.0;
  }
  return colour;
}
`;
