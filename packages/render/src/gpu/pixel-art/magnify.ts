/**
 * xBR's twelve texels around the judged corner, as `(dx, dy)` from the centre texel along the mirroring
 * step `magnifyWindowStep` returns, named after Hyllian's description with the corner at the lower right.
 * The order is the `XbrNeighbours` field order.
 */
export const XBR_NEIGHBOURS = [
  ['e', 0, 0],
  ['f', 1, 0],
  ['h', 0, 1],
  ['i', 1, 1],
  ['b', 0, -1],
  ['c', 1, -1],
  ['d', -1, 0],
  ['g', -1, 1],
  ['f4', 2, 0],
  ['i4', 2, 1],
  ['h5', 0, 2],
  ['i5', 1, 2],
] as const;

/** The leading neighbours that form the 2x2 window the sharp magnifier blends: e, f, h and i. */
const XBR_WINDOW_TAPS = 4;
const XBR_WINDOW = XBR_NEIGHBOURS.slice(0, XBR_WINDOW_TAPS);
const XBR_OUTER = XBR_NEIGHBOURS.slice(XBR_WINDOW_TAPS);

/**
 * The magnifiers' arithmetic, which reads no texel itself: a host that gathers its taps ahead of the
 * magnifiers hands them in as values, so no tap is addressed at run time. `XBR_NEIGHBOURS_OF(TAP)` builds
 * the neighbourhood from a host macro `TAP(dx, dy)` naming the texel at `centre + (dx, dy) * step`.
 */
/** Texels per pixel under which a page counts as magnified. The uv derivatives of a tall page carry
 *  rounding noise of a few thousandths of a texel, which at one texel per pixel sent a grid of pixel
 *  quads through the magnifier; within one hundredth of a texel per pixel the page is drawn 1:1. */
export const MAGNIFIED_BELOW = 0.99;

export const PIXEL_ART_MAGNIFY_CORE_GLSL = /* glsl */ `
const float MAGNIFIED_BELOW = ${MAGNIFIED_BELOW.toFixed(6)};
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

// Nearest inside a texel, one screen pixel of blend across each texel boundary: crisp pixels that
// no longer shimmer under subpixel placement. The weights of the 2x2 at floor(p - 0.5).
vec2 magnifySharpWeights(vec2 p, float texelsPerPixel) {
  vec2 q = p - 0.5;
  return clamp((fract(q) - 0.5) / max(texelsPerPixel, MIN_TEXELS_PER_PIXEL) + 0.5, 0.0, 1.0);
}

// Luma-weighted RGB plus alpha on premultiplied texels, so a silhouette against transparency is a
// strong edge and a shading band a weak one.
float magnifyDistance(vec4 a, vec4 b) {
  vec4 d = abs(a - b);
  return dot(d.rgb, MAGNIFY_LUMA_WEIGHTS) + d.a;
}

const float MAGNIFY_DISTINCT = 1.0 / 255.0; // two texels differ once any channel moves a level

// The mirroring that puts the texel corner nearest the fragment at the lower right, so every tap
// below reads the same way for all four corners.
ivec2 magnifyWindowStep(vec2 fp) {
  return ivec2(fp.x >= 0.5 ? 1 : -1, fp.y >= 0.5 ? 1 : -1);
}

struct XbrNeighbours {
  vec4 ${XBR_NEIGHBOURS.map(([name]) => name).join(', ')};
};
#define XBR_NEIGHBOURS_OF(TAP) XbrNeighbours(${XBR_NEIGHBOURS.map(([, dx, dy]) => `TAP(${dx}, ${dy})`).join(', ')})

// Whether xBR keeps the sharp base at the corner of e, f and h without reading the rest of the
// window: an edge needs e to differ from both neighbours.
bool magnifyXbrKeepsBase(vec4 e, vec4 f, vec4 h) {
  return magnifyDistance(e, f) < MAGNIFY_DISTINCT || magnifyDistance(e, h) < MAGNIFY_DISTINCT;
}

// Edge-directed magnification after the published xBR rule set (Hyllian's 2011 algorithm; an
// approximation, not an original-engine mechanism): a diagonal edge through a texel's corner is
// redrawn as a straight cut at 45, ~27 or ~63 degrees, filled with the neighbour that continues
// the edge. Only the corner nearest the fragment is judged, from its neighbourhood n; base is the
// sharp magnification kept where no edge runs.
vec4 magnifyXbrCorner(XbrNeighbours n, vec4 base, vec2 p, float texelsPerPixel) {
  vec2 local = abs(fract(p) - 0.5); // 0 at the texel centre, 0.5 at the judged corner
  if (magnifyXbrKeepsBase(n.e, n.f, n.h)) return base;
  float ef = magnifyDistance(n.e, n.f);
  float eh = magnifyDistance(n.e, n.h);
  // The corner is an edge when the diagonal e-i is a stronger contrast than the diagonal f-h.
  float along = magnifyDistance(n.e, n.c) + magnifyDistance(n.e, n.g) + magnifyDistance(n.i, n.h5)
              + magnifyDistance(n.i, n.f4) + XBR_DIAGONAL_WEIGHT * magnifyDistance(n.h, n.f);
  float across = magnifyDistance(n.h, n.d) + magnifyDistance(n.h, n.i5) + magnifyDistance(n.f, n.i4)
               + magnifyDistance(n.f, n.b) + XBR_DIAGONAL_WEIGHT * magnifyDistance(n.e, n.i);
  if (along >= across) return base;
  float fg = magnifyDistance(n.f, n.g);
  float hc = magnifyDistance(n.h, n.c);
  // The 45 degree cut, plus the two shallower slopes taken when the edge continues past g or c.
  // Each blends over one screen pixel, carried as the half-width aa in texel units.
  float aa = 0.5 * texelsPerPixel;
  float diagonal = aa * XBR_CUT_DIAGONAL_GRADIENT;
  float shallow = aa * XBR_CUT_SHALLOW_GRADIENT;
  float cut = smoothstep(XBR_CUT_DIAGONAL - diagonal, XBR_CUT_DIAGONAL + diagonal, local.x + local.y);
  if (XBR_SHOULDER_RATIO * fg <= hc && magnifyDistance(n.e, n.g) >= MAGNIFY_DISTINCT && magnifyDistance(n.d, n.g) >= MAGNIFY_DISTINCT) {
    cut = max(cut, smoothstep(XBR_CUT_SHALLOW - shallow, XBR_CUT_SHALLOW + shallow, local.y + 0.5 * local.x));
  }
  if (fg >= XBR_SHOULDER_RATIO * hc && magnifyDistance(n.e, n.c) >= MAGNIFY_DISTINCT && magnifyDistance(n.b, n.c) >= MAGNIFY_DISTINCT) {
    cut = max(cut, smoothstep(XBR_CUT_SHALLOW - shallow, XBR_CUT_SHALLOW + shallow, local.x + 0.5 * local.y));
  }
  return mix(base, ef <= eh ? n.f : n.h, cut);
}
`;

/**
 * GLSL for magnifying pixel art without blur, shared by the paletted-character and dismantle shaders.
 * The host defines `MAGNIFY_FETCH(ivec2 px)` returning that texel as premultiplied RGBA (transparent
 * outside the current frame) before including this block. `p` is the sample point in texel units and
 * `texelsPerPixel` the screen-pixel footprint; both modes converge on bilinear as texels reach pixel
 * size.
 */
export const PIXEL_ART_MAGNIFY_GLSL = /* glsl */ `${PIXEL_ART_MAGNIFY_CORE_GLSL}
// Blend of the texel at base with its right/down neighbours by weights f; weight 0 is base's centre.
vec4 magnifyBlend(ivec2 base, vec2 f) {
  return mix(mix(MAGNIFY_FETCH(base), MAGNIFY_FETCH(base + ivec2(1, 0)), f.x),
             mix(MAGNIFY_FETCH(base + ivec2(0, 1)), MAGNIFY_FETCH(base + ivec2(1, 1)), f.x), f.y);
}

vec4 magnifyBilinear(vec2 p) {
  vec2 q = p - 0.5;
  return magnifyBlend(ivec2(floor(q)), fract(q));
}

vec4 magnifySharp(vec2 p, float texelsPerPixel) {
  return magnifyBlend(ivec2(floor(p - 0.5)), magnifySharpWeights(p, texelsPerPixel));
}

// magnifySharp from xBR's own e, f, h and i. They are the 2x2 at floor(p - 0.5) in mirrored order;
// where rounding puts that window a texel off the mirroring step, its weight there is 0 and e stands.
vec4 magnifySharpWindow(vec4 e, vec4 f, vec4 h, vec4 i, vec2 p, float texelsPerPixel) {
  vec2 w = magnifySharpWeights(p, texelsPerPixel);
  bvec2 leads = equal(ivec2(floor(p - 0.5)), ivec2(floor(p)));
  vec4 eRow = leads.x ? mix(e, f, w.x) : mix(f, e, w.x);
  vec4 hRow = leads.x ? mix(h, i, w.x) : mix(i, h, w.x);
  return leads.y ? mix(eRow, hRow, w.y) : mix(hRow, eRow, w.y);
}

// For texels at most a pixel wide. Only a corner that can be an edge reads the outer eight texels.
vec4 magnifyXbr(vec2 p, float texelsPerPixel) {
  ivec2 centre = ivec2(floor(p));
  ivec2 s = magnifyWindowStep(fract(p));
  #define MAGNIFY_TAP(dx, dy) MAGNIFY_FETCH(centre + ivec2(dx, dy) * s)
${XBR_WINDOW.map(([name, dx, dy]) => `  vec4 ${name} = MAGNIFY_TAP(${dx}, ${dy});`).join('\n')}
  vec4 colour = magnifySharpWindow(${XBR_WINDOW.map(([name]) => name).join(', ')}, p, texelsPerPixel);
  if (!magnifyXbrKeepsBase(e, f, h)) {
    XbrNeighbours n = XbrNeighbours(${XBR_WINDOW.map(([name]) => name).join(', ')},
      ${XBR_OUTER.map(([, dx, dy]) => `MAGNIFY_TAP(${dx}, ${dy})`).join(', ')});
    colour = magnifyXbrCorner(n, colour, p, texelsPerPixel);
  }
  #undef MAGNIFY_TAP
  return colour;
}
`;
