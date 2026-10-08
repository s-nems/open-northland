/** Authored splashes in layer-local UVs follow animation frames and use the body's existing coverage.
 * This is a surface approximation, not a wound attached to a skeletal animation. No texture taps. */
export const BLOOD_COAT_GLSL = /* glsl */ `
float bloodHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float bloodNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bloodHash(cell), bloodHash(cell + vec2(1.0, 0.0)), f.x),
             mix(bloodHash(cell + vec2(0.0, 1.0)), bloodHash(cell + vec2(1.0)), f.x), f.y);
}

vec3 coatBlood(vec3 colour, vec2 uv, float coatData) {
  float amount = mod(coatData, 256.0) / 255.0;
  float dry = mod(floor(coatData / 256.0), 256.0) / 255.0;
  float seed = floor(coatData / 65536.0);
  vec2 p = uv * vec2(4.5, 6.0) + vec2(seed, seed * 0.37);
  float coarse = bloodNoise(p);
  float detail = bloodNoise(p * 2.13 + 17.0);
  float grain = bloodNoise(p * 5.1 + 31.0);
  float field = coarse * 0.6 + detail * 0.27 + grain * 0.13;
  float threshold = mix(0.72, 0.46, amount);
  float blot = smoothstep(threshold - 0.035, threshold + 0.045, field);
  // Narrow vertical smears share the main blot's edge, rather than tiling round dots over the body.
  float run = smoothstep(0.65, 0.8, bloodNoise(uv * vec2(19.0, 3.0) + seed))
            * smoothstep(threshold - 0.15, threshold, field);
  vec2 fine = uv * vec2(21.0, 29.0) + seed;
  float speckle = bloodHash(floor(fine));
  float dotMask = (1.0 - smoothstep(0.08, 0.21, length(fract(fine) - 0.5)))
                * step(speckle, amount * 0.2);
  float mask = max(max(blot, run), dotMask) * 0.94 * smoothstep(0.0, 0.25, amount);
  float light = dot(colour, vec3(0.25, 0.6, 0.15));
  vec3 dark = mix(vec3(0.28, 0.012, 0.018), vec3(0.19, 0.035, 0.028), dry);
  vec3 red = mix(vec3(0.67, 0.035, 0.025), vec3(0.37, 0.052, 0.035), dry);
  vec3 pigment = mix(dark, red, 0.25 + detail * 0.6);
  pigment *= 0.65 + light * 0.7;
  float glint = smoothstep(0.72, 0.86, grain) * smoothstep(0.5, 0.75, detail);
  pigment += vec3(0.2, 0.085, 0.065) * glint * (1.0 - dry);
  return mix(colour, pigment, mask);
}
`;
