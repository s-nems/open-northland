/**
 * Music-value resolution and curve interpolation for the performance interpreter. The resolver
 * follows the retail dmime synthesizer as documented from binary analysis by the GothicKit dmusic
 * project (MIT): chord-root play modes place the resolved note one octave below the raw octave
 * nibble, and a note flagged DMUS_PLAYMODE_NONE inherits the part's play mode. Validated against
 * an in-game recording of the owned copy and event-parity with the previously vendored renderer.
 */

export const DMUS_PLAYMODE_FIXED = 0;
export const DMUS_PLAYMODE_KEY_ROOT = 1;
export const DMUS_PLAYMODE_CHORD_ROOT = 2;
export const DMUS_PLAYMODE_SCALE_INTERVALS = 4;
export const DMUS_PLAYMODE_CHORD_INTERVALS = 8;
export const DMUS_PLAYMODE_NONE = 16;

export const DMUS_CURVET_PBCURVE = 3;
export const DMUS_CURVET_CCCURVE = 4;

const DMUS_CURVES_INSTANT = 1;
const DMUS_CURVES_EXP = 2;
const DMUS_CURVES_LOG = 3;
const DMUS_CURVES_SINE = 4;

/** Default performance subchord: root C, major triad, one two-octave major scale. */
const DEFAULT_CHORD_ROOT = 12;
const DEFAULT_CHORD_PATTERN = 0x00000091;
const DEFAULT_SCALE_PATTERN = 0x00ab5ab5;

/** The performance chord used when a segment schedules notes without a chord track. */
export const DEFAULT_PERFORMANCE_CHORD = DEFAULT_CHORD_ROOT << 24;

/** One replacement scale per chromatic root, substituted when a pattern is degenerate. */
const FALLBACK_SCALES = [
  0xab5ab5, 0x6ad6ad, 0x5ab5ab, 0xad5ad5, 0x6b56b5, 0x5ad5ad, 0x56b56b, 0xd5ad5a, 0xb56b56, 0xd6ad6a,
  0xb5ab5a, 0xad6ad6,
] as const;

const OCTAVE = 12;
const MIDI_MAX = 127;
const U16 = 0xffff;

function countBits(v: number): number {
  let count = 0;
  for (let x = v >>> 0; x !== 0; x >>>= 1) count += x & 1;
  return count;
}

function normalizeScale(scale: number, scaleRoot: number): number {
  // Force the scale to exactly two octaves, rotate it to the root, and re-normalize. The & 12
  // root mask mirrors the retail binary as documented; the corpus only authors scale root 0.
  let s = ((scale & 0x0fff) | (scale << 12)) >>> 0;
  s = s >>> (12 - (scaleRoot & 12));
  s = ((s & 0x0fff) | (s << 12)) >>> 0;
  if (countBits(s & 0xfff) <= 4) {
    let best: number = FALLBACK_SCALES[0];
    let bestScore = 0;
    for (const fallback of FALLBACK_SCALES) {
      const score = countBits(fallback & s & 0xfff);
      if (score > bestScore) {
        best = fallback;
        bestScore = score;
      }
    }
    s = best;
  }
  // Copy the second octave into the empty third so long walks stay in scale.
  if ((s & 0xff000000) === 0) s = (s | ((s & 0xfff000) << 12)) >>> 0;
  return s;
}

/** The first subchord of the current chord, `DMUS_IO_SUBCHORD` fields. */
export interface Subchord {
  readonly chordPattern: number;
  readonly scalePattern: number;
  readonly chordRoot: number;
  readonly scaleRoot: number;
}

/**
 * Resolves a style note's music value to a MIDI key, or undefined when the play mode drops the
 * note (key-root modes and modes without interval flags never produce a key).
 */
export function musicValueToMidi(
  chord: number,
  subchord: Subchord | undefined,
  musicValueRaw: number,
  notePlayMode: number,
  partPlayMode: number,
): number | undefined {
  const mode = notePlayMode === DMUS_PLAYMODE_NONE ? partPlayMode : notePlayMode;
  if (mode === DMUS_PLAYMODE_FIXED) return musicValueRaw & 0x7f;

  const sub: Subchord = subchord ?? {
    chordRoot: (chord >>> 24) & 0xff,
    scaleRoot: 0,
    chordPattern: DEFAULT_CHORD_PATTERN,
    scalePattern: DEFAULT_SCALE_PATTERN,
  };

  let musicValue = musicValueRaw & U16;
  let wrapOffset = 0;
  // A negative octave nibble transposes up while remembering the octaves to give back.
  while (musicValue >= 0xe000) {
    musicValue = (musicValue + 0x1000) & U16;
    wrapOffset -= OCTAVE;
  }
  // Keep the scale-offset nibble addable without spilling into the chord nibble.
  const scaleNibblePlus = ((musicValue & 0x00f0) + 0x0070) & U16;
  if ((scaleNibblePlus & 0x0f00) !== 0) {
    musicValue = ((musicValue & 0xff0f) | (scaleNibblePlus & 0x00f0)) & U16;
    wrapOffset -= OCTAVE;
  }

  let root = 0;
  if (mode & DMUS_PLAYMODE_CHORD_ROOT) {
    root = sub.chordRoot;
  } else if (mode & DMUS_PLAYMODE_KEY_ROOT) {
    return undefined;
  }
  if ((mode & (DMUS_PLAYMODE_CHORD_INTERVALS | DMUS_PLAYMODE_SCALE_INTERVALS)) === 0) {
    return undefined;
  }

  const scalePattern = normalizeScale(
    sub.scalePattern !== 0 ? sub.scalePattern : DEFAULT_SCALE_PATTERN,
    sub.scaleRoot,
  );
  const chordPattern = (sub.chordPattern !== 0 ? sub.chordPattern : 1) >>> 0;

  const chordPosition = (musicValue & 0x0f00) >> 8;
  const scalePosition = (musicValue & 0x0070) >> 4;
  let accidentals = musicValue & 0x000f;
  if (accidentals > 8) accidentals -= 16;

  let noteValue = 0;
  let noteOffset = 0;
  let walkPattern = 0;
  let walkPosition = 0;

  const rootOctave = root % OCTAVE;
  const chordBits = countBits(chordPattern);

  if (mode & DMUS_PLAYMODE_CHORD_INTERVALS && scalePosition === 0 && chordPosition < chordBits) {
    noteOffset = root + accidentals;
    walkPattern = chordPattern;
    walkPosition = chordPosition;
  } else if (mode & DMUS_PLAYMODE_CHORD_INTERVALS && chordPosition < chordBits) {
    walkPattern = chordPattern;
    walkPosition = chordPosition;
    // Walk to the chord tone first, then continue the scale from there.
    if (walkPattern !== 0) {
      while ((walkPattern & 1) === 0) {
        walkPattern >>>= 1;
        noteValue += 1;
      }
    }
    if (walkPosition > 0) {
      do {
        walkPattern >>>= 1;
        noteValue += 1;
        if (walkPattern & 1) walkPosition -= 1;
        if (walkPattern === 0) {
          noteValue += walkPosition;
          break;
        }
      } while (walkPosition > 0);
    }
    noteValue += rootOctave;
    noteOffset = accidentals + root - rootOctave;
    walkPattern = scalePattern >>> (noteValue % OCTAVE);
    walkPosition = scalePosition;
  } else if (mode & DMUS_PLAYMODE_SCALE_INTERVALS) {
    noteValue = rootOctave;
    noteOffset = accidentals + root - rootOctave;
    walkPattern = scalePattern >>> rootOctave;
    walkPosition = chordPosition * 2 + scalePosition;
  } else {
    return undefined;
  }

  walkPosition += 1;
  while (walkPosition > 0) {
    noteValue += 1;
    if (walkPattern & 1) walkPosition -= 1;
    if (walkPattern === 0) {
      noteValue += walkPosition;
      break;
    }
    walkPattern >>>= 1;
  }
  noteValue -= 1;

  noteValue += noteOffset + wrapOffset;
  const octave = (musicValue & 0xf000) >> 12;
  noteValue += octave * OCTAVE;
  if (mode & DMUS_PLAYMODE_CHORD_ROOT) noteValue -= OCTAVE;

  while (noteValue < 0) noteValue += OCTAVE;
  while (noteValue > MIDI_MAX) noteValue -= OCTAVE;
  return noteValue;
}

/** The pi literal the reference interpolator authors (not `Math.PI`). */
const CURVE_PI = 3.14159265359;
const f32 = Math.fround;

/**
 * Curve interpolation at `phase` in [0, 1), evaluated in single precision exactly like the
 * reference renderer so replayed controller values match its output bit for bit.
 */
export function curveValue(shape: number, phase: number, startValue: number, endValue: number): number {
  switch (shape) {
    case DMUS_CURVES_INSTANT:
      return endValue;
    case DMUS_CURVES_EXP:
      return lerp(f32(f32(f32(phase * phase) * phase) * phase), startValue, endValue);
    case DMUS_CURVES_LOG:
      return lerp(f32(Math.sqrt(phase)), startValue, endValue);
    case DMUS_CURVES_SINE: {
      const sine = f32(Math.sin(f32(f32(phase - 0.5) * CURVE_PI)));
      return lerp(f32(f32(sine + 1) * 0.5), startValue, endValue);
    }
    default:
      return lerp(phase, startValue, endValue);
  }
}

function lerp(x: number, start: number, end: number): number {
  return f32(f32(f32(1 - x) * start) + f32(x * end));
}
