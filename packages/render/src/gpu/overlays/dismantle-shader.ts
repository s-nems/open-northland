import { PIXEL_ART_MAGNIFY_GLSL } from '../pixel-art-magnify.js';
import type { GlslProgramSource } from '../program-source.js';

/** Frozen damaged pixels and an authored construction mask; the geometry never moves. Sampling uses
 * the world's magnifiers so entering demolition does not change the building's sharpness. */
export const DISMANTLE_SOURCE: GlslProgramSource = {
  name: 'building-dismantle',
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
precision highp int;
in vec2 vUV;
in vec4 vColour;
uniform sampler2D uTexture;
uniform sampler2D uRemoval;
// Colour frame in atlas texels (origin, size), mask origin in its shared atlas.
uniform vec4 uFrame;
uniform vec2 uMaskOrigin;
// Progress, magnifier mode, introduced backing opacity, material shade.
uniform vec4 uDismantle;
out vec4 finalColor;

vec4 dismantleTexel(ivec2 px) {
  ivec2 local = px - ivec2(uFrame.xy);
  if (any(lessThan(local, ivec2(0))) || any(greaterThanEqual(local, ivec2(uFrame.zw)))) return vec4(0.0);
  vec4 material = texelFetch(uRemoval, ivec2(uMaskOrigin) + local, 0);
  float edge = 0.012 + material.g * 0.014;
  float kept = smoothstep(uDismantle.x - edge, uDismantle.x + edge, material.r);
  vec4 colour = texelFetch(uTexture, px, 0);
  // A narrow, shaded broken lip precedes removal, rather than tinting the whole building darker.
  float lip = (1.0 - smoothstep(edge, edge + 0.03, material.r - uDismantle.x)) * step(0.01, uDismantle.x);
  colour.rgb *= uDismantle.w * (1.0 - lip * 0.22);
  return colour * kept;
}

#define MAGNIFY_FETCH(px) dismantleTexel(px)
${PIXEL_ART_MAGNIFY_GLSL}

void main() {
  vec2 p = uFrame.xy + vUV * uFrame.zw;
  float footprint = max(fwidth(p.x), fwidth(p.y));
  vec4 colour;
  if (footprint < 1.0 && uDismantle.y > 2.5) colour = magnifyXbr(p, footprint);
  else if (footprint < 1.0 && uDismantle.y > 1.5) colour = magnifySharp(p, footprint);
  else if (uDismantle.y < 0.5) colour = dismantleTexel(ivec2(floor(p)));
  else {
    vec2 d = max(fwidth(p) - 1.0, vec2(0.0)) * 0.25;
    colour = 0.25 * (magnifyBilinear(p - d) + magnifyBilinear(p + d)
      + magnifyBilinear(p + vec2(d.x, -d.y)) + magnifyBilinear(p + vec2(-d.x, d.y)));
  }
  finalColor = colour * vColour * uDismantle.z;
}`,
};
