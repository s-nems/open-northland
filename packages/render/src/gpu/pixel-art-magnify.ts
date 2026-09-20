/**
 * GLSL for magnifying pixel art without blur, shared by the paletted-character shader and the world
 * batch shader. The host defines `MAGNIFY_FETCH(ivec2 px)` returning that texel as premultiplied RGBA
 * (transparent outside the current frame) before including this block. `p` is the sample point in
 * texel units and `texelsPerPixel` the screen-pixel footprint; both modes converge on bilinear as
 * texels reach pixel size.
 */
export const PIXEL_ART_MAGNIFY_GLSL = /* glsl */ `
/** Floor on the screen-pixel footprint, so a degenerate transform cannot divide by zero. */
const float MIN_TEXELS_PER_PIXEL = 0.0001;
/** Rec. 601 luma weights, the published grey the texel distance is measured in. */
const vec3 MAGNIFY_LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);
/** xBR's published weights (Hyllian 2011). The diagonal comparison counts the direct pair four times
 *  its four continuation taps, and a shallower cut needs one shoulder at twice the other. */
const float XBR_DIAGONAL_WEIGHT = 4.0;
const float XBR_SHOULDER_RATIO = 2.0;
/** Cut lines in corner-local texel units, and the gradient of each line's expression: |grad(u + v)| is
 *  sqrt(2) and |grad(v + u/2)| is sqrt(1.25), which convert the blend half-width to that line's normal. */
const float XBR_CUT_DIAGONAL = 0.5;
const float XBR_CUT_DIAGONAL_GRADIENT = 1.4142;
const float XBR_CUT_SHALLOW = 0.25;
const float XBR_CUT_SHALLOW_GRADIENT = 1.118;

// Blend of the texel at base with its right/down neighbours by weights f; weight 0 is base's centre.
vec4 magnifyBlend(ivec2 base, vec2 f) {
  return mix(mix(MAGNIFY_FETCH(base), MAGNIFY_FETCH(base + ivec2(1, 0)), f.x),
             mix(MAGNIFY_FETCH(base + ivec2(0, 1)), MAGNIFY_FETCH(base + ivec2(1, 1)), f.x), f.y);
}

vec4 magnifyBilinear(vec2 p) {
  vec2 q = p - 0.5;
  return magnifyBlend(ivec2(floor(q)), fract(q));
}

// Nearest inside a texel, one screen pixel of blend across each texel boundary: crisp pixels that
// no longer shimmer under subpixel placement.
vec4 magnifySharp(vec2 p, float texelsPerPixel) {
  vec2 q = p - 0.5;
  vec2 f = clamp((fract(q) - 0.5) / max(texelsPerPixel, MIN_TEXELS_PER_PIXEL) + 0.5, 0.0, 1.0);
  return magnifyBlend(ivec2(floor(q)), f);
}

// Luma-weighted RGB plus alpha on premultiplied texels, so a silhouette against transparency is a
// strong edge and a shading band a weak one.
float magnifyDistance(vec4 a, vec4 b) {
  vec4 d = abs(a - b);
  return dot(d.rgb, MAGNIFY_LUMA_WEIGHTS) + d.a;
}

const float MAGNIFY_DISTINCT = 1.0 / 255.0; // two texels differ once any channel moves a level

// Edge-directed magnification after the published xBR rule set (Hyllian's 2011 algorithm; an
// approximation, not an original-engine mechanism): a diagonal edge through a texel's corner is
// redrawn as a straight cut at 45, ~27 or ~63 degrees, filled with the neighbour that continues
// the edge. Only the corner nearest the fragment is judged; s mirrors that corner onto one
// orientation so the 3x3 core plus its two outer taps read the same way for all four corners.
vec4 magnifyXbr(vec2 p, float texelsPerPixel) {
  ivec2 centre = ivec2(floor(p));
  vec2 fp = fract(p);
  ivec2 s = ivec2(fp.x >= 0.5 ? 1 : -1, fp.y >= 0.5 ? 1 : -1);
  vec2 local = abs(fp - 0.5); // 0 at the texel centre, 0.5 at the judged corner
  #define MAGNIFY_TAP(dx, dy) MAGNIFY_FETCH(centre + ivec2(dx, dy) * s)
  vec4 e = MAGNIFY_TAP(0, 0);
  vec4 f = MAGNIFY_TAP(1, 0);
  vec4 h = MAGNIFY_TAP(0, 1);
  vec4 i = MAGNIFY_TAP(1, 1);
  vec4 b = MAGNIFY_TAP(0, -1);
  vec4 c = MAGNIFY_TAP(1, -1);
  vec4 d = MAGNIFY_TAP(-1, 0);
  vec4 g = MAGNIFY_TAP(-1, 1);
  vec4 f4 = MAGNIFY_TAP(2, 0);
  vec4 i4 = MAGNIFY_TAP(2, 1);
  vec4 h5 = MAGNIFY_TAP(0, 2);
  vec4 i5 = MAGNIFY_TAP(1, 2);
  #undef MAGNIFY_TAP
  vec4 base = magnifySharp(p, texelsPerPixel);
  float ef = magnifyDistance(e, f);
  float eh = magnifyDistance(e, h);
  if (ef < MAGNIFY_DISTINCT || eh < MAGNIFY_DISTINCT) return base;
  // The corner is an edge when the diagonal e-i is a stronger contrast than the diagonal f-h.
  float along = magnifyDistance(e, c) + magnifyDistance(e, g) + magnifyDistance(i, h5)
              + magnifyDistance(i, f4) + XBR_DIAGONAL_WEIGHT * magnifyDistance(h, f);
  float across = magnifyDistance(h, d) + magnifyDistance(h, i5) + magnifyDistance(f, i4)
               + magnifyDistance(f, b) + XBR_DIAGONAL_WEIGHT * magnifyDistance(e, i);
  if (along >= across) return base;
  float fg = magnifyDistance(f, g);
  float hc = magnifyDistance(h, c);
  // The 45 degree cut, plus the two shallower slopes taken when the edge continues past g or c.
  // Each blends over one screen pixel, carried as the half-width aa in texel units.
  float aa = 0.5 * texelsPerPixel;
  float diagonal = aa * XBR_CUT_DIAGONAL_GRADIENT;
  float shallow = aa * XBR_CUT_SHALLOW_GRADIENT;
  float cut = smoothstep(XBR_CUT_DIAGONAL - diagonal, XBR_CUT_DIAGONAL + diagonal, local.x + local.y);
  if (XBR_SHOULDER_RATIO * fg <= hc && magnifyDistance(e, g) >= MAGNIFY_DISTINCT && magnifyDistance(d, g) >= MAGNIFY_DISTINCT) {
    cut = max(cut, smoothstep(XBR_CUT_SHALLOW - shallow, XBR_CUT_SHALLOW + shallow, local.y + 0.5 * local.x));
  }
  if (fg >= XBR_SHOULDER_RATIO * hc && magnifyDistance(e, c) >= MAGNIFY_DISTINCT && magnifyDistance(b, c) >= MAGNIFY_DISTINCT) {
    cut = max(cut, smoothstep(XBR_CUT_SHALLOW - shallow, XBR_CUT_SHALLOW + shallow, local.x + 0.5 * local.y));
  }
  return mix(base, ef <= eh ? f : h, cut);
}
`;
