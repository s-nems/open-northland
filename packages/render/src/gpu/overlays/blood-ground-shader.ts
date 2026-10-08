import { BLOOD_LIFETIME_TICKS } from '../../data/effects/blood.js';
import type { GlslProgramSource } from '../program-source.js';

/** Existing stain shapes and drying, animated per vertex so settled ground needs no CPU updates. */
export const BLOOD_GROUND_SOURCE: GlslProgramSource = {
  name: 'blood-ground',
  vertex: `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec2 aCentre;
// Spawn tick, contact delay, spread duration, initial/full scale ratio.
in vec4 aLife;
// Water/strength opacity, impression shade, drying duration.
in vec3 aShade;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform float uTime;
out vec2 vUV;
out vec4 vColour;
void main() {
  // Wrapped clock stays precise after days of play; no mark lives through one wrap.
  float age = mod(uTime - aLife.x + 4096.0, 4096.0);
  float spread = smoothstep(0.0, 1.0, (age - aLife.y) / aLife.z);
  float scale = mix(aLife.w, 1.0, spread);
  vec2 position = aCentre + (aPosition - aCentre) * scale;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  float fade = 1.0 - smoothstep(${BLOOD_LIFETIME_TICKS * 0.6}.0, ${BLOOD_LIFETIME_TICKS}.0, age);
  float dry = smoothstep(0.0, 1.0, (age - 48.0) / aShade.z);
  vec3 tint = floor(vec3(255.0) - dry * vec3(45.0, 95.0, 110.0) + 0.5);
  tint = floor(tint * aShade.y) / 255.0;
  float alpha = floor(clamp(spread * fade * aShade.x, 0.0, 1.0) * 255.0) / 255.0;
  vColour = vec4(tint * alpha, alpha) * uColor * uWorldColorAlpha;
  vUV = aUV;
}`,
  fragment: `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColour;
uniform sampler2D uTexture;
out vec4 finalColor;
void main() {
  finalColor = texture(uTexture, vUV) * vColour;
}`,
};
