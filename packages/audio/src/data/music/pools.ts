import { MUSIC_VARIANTS, type MusicVariants } from './catalog.js';
import type { MusicManifest } from './manifest.js';

/**
 * Which rendered stems can stand in for one another. A map code belongs to the culture its stem names,
 * and the culture's calm and tense pools gather every stem of every code of that culture, so a map can
 * rotate through its kin's music instead of ringing one loop region. The pools are a design choice of
 * this reimplementation: the original plays one segment per map and only switches its mood.
 */

/** A music culture: the families the segment names group into. */
export type MusicCulture = 'norse' | 'frank' | 'byzantine' | 'arab' | 'underworld';

/** Whether a stem fits a quiet stretch or a fight. */
export type MusicIntensity = 'calm' | 'tense';

/** The words segment stems use for each culture, digits stripped (`viking1` reads as `viking`). */
const CULTURE_BY_STEM_WORD: Readonly<Record<string, MusicCulture>> = {
  viking: 'norse',
  midgard: 'norse',
  nordland: 'norse',
  asgard: 'norse',
  franken: 'frank',
  byzanz: 'byzantine',
  arabs: 'arab',
  underworld: 'underworld',
};

/** How a culture with too little music of its own fills its pools from a kin culture. */
interface Borrowing {
  readonly from: MusicCulture;
  /** Calm stems taken, quietest first, so the borrowed music keeps the lender's softest mood. */
  readonly quietestCalm: number;
}

/** Underworld authored one calm stem and no tense one; the Norse are its kin. Approximation: the two
 *  quietest Norse calm stems are the Nordland and Asgard add-on tracks, the closest in colour. */
const BORROWINGS: Readonly<Partial<Record<MusicCulture, Borrowing>>> = {
  underworld: { from: 'norse', quietestCalm: 2 },
};

/** A culture's interchangeable stems, each distinct audio, in stem order. */
export interface MusicPools {
  readonly calm: readonly string[];
  readonly tense: readonly string[];
}

/** One map code's music: its culture, the culture's pools, and the stems the code itself authored. */
export interface MapMusic {
  readonly culture: MusicCulture;
  readonly pools: MusicPools;
  readonly variants: MusicVariants;
}

/** The culture a stem's words name, or null for a stem outside every culture. */
export function cultureOfStem(stem: string): MusicCulture | null {
  for (const word of stem.split('_')) {
    const culture = CULTURE_BY_STEM_WORD[word.replace(/\d+$/, '')];
    if (culture !== undefined) return culture;
  }
  return null;
}

/** A code's stems by intensity. A stem a code repeats in a tense slot (a mission with no Danger
 *  segment) stays calm only. */
function stemsByIntensity(variants: MusicVariants): Readonly<Record<MusicIntensity, readonly string[]>> {
  switch (variants.family) {
    case 'attack':
      return { calm: [], tense: [variants.stem] };
    case 'theme': {
      const { friendly, neutral, hostile } = variants.stems;
      const calm = [friendly, neutral];
      return { calm, tense: calm.includes(hostile) ? [] : [hostile] };
    }
    case 'mission': {
      const { standard, wealthy, danger } = variants.stems;
      const calm = [standard, wealthy];
      return { calm, tense: calm.includes(danger) ? [] : [danger] };
    }
  }
}

/** `stems` sorted, rendered, and folded to one stem per distinct audio. */
function distinctRendered(stems: Iterable<string>, manifest: MusicManifest): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const stem of [...new Set(stems)].sort()) {
    const track = manifest.tracks[stem];
    if (track === undefined || seen.has(track.segmentSha256)) continue;
    seen.add(track.segmentSha256);
    kept.push(stem);
  }
  return kept;
}

/** Every culture's own pools, before any borrowing. */
function ownPools(manifest: MusicManifest): Map<MusicCulture, MusicPools> {
  const gathered = new Map<MusicCulture, { calm: string[]; tense: string[] }>();
  for (const variants of Object.values(MUSIC_VARIANTS)) {
    const { calm, tense } = stemsByIntensity(variants);
    const culture = cultureOfStem(calm[0] ?? tense[0] ?? '');
    if (culture === null) continue;
    const pools = gathered.get(culture) ?? { calm: [], tense: [] };
    pools.calm.push(...calm);
    pools.tense.push(...tense);
    gathered.set(culture, pools);
  }
  const pools = new Map<MusicCulture, MusicPools>();
  for (const [culture, { calm, tense }] of gathered) {
    const calmPool = distinctRendered(calm, manifest);
    // A stem that is the same audio as a calm one stays calm.
    const calmAudio = new Set(calmPool.map((stem) => manifest.tracks[stem]?.segmentSha256));
    const tensePool = distinctRendered(tense, manifest).filter(
      (stem) => !calmAudio.has(manifest.tracks[stem]?.segmentSha256),
    );
    pools.set(culture, { calm: calmPool, tense: tensePool });
  }
  return pools;
}

/** Each culture's pools, a borrowing culture's topped up from its lender. */
export function culturePools(manifest: MusicManifest): ReadonlyMap<MusicCulture, MusicPools> {
  const pools = ownPools(manifest);
  for (const [culture, borrowing] of Object.entries(BORROWINGS) as [MusicCulture, Borrowing][]) {
    const own = pools.get(culture) ?? { calm: [], tense: [] };
    const lender = pools.get(borrowing.from) ?? { calm: [], tense: [] };
    const loudness = (stem: string): number =>
      manifest.tracks[stem]?.loudnessLufs ?? Number.POSITIVE_INFINITY;
    const quietest = [...lender.calm]
      .sort((a, b) => loudness(a) - loudness(b))
      .slice(0, borrowing.quietestCalm);
    pools.set(culture, {
      calm: [...own.calm, ...quietest],
      tense: own.tense.length > 0 ? own.tense : lender.tense,
    });
  }
  return pools;
}

/** The music a map's `musictype` plays, or null when the code names no segment or no rendered stem. */
export function mapMusicFor(musicType: number | undefined, manifest: MusicManifest | null): MapMusic | null {
  if (musicType === undefined || manifest === null) return null;
  const variants = MUSIC_VARIANTS[musicType];
  if (variants === undefined) return null;
  const { calm, tense } = stemsByIntensity(variants);
  const culture = cultureOfStem(calm[0] ?? tense[0] ?? '');
  if (culture === null) return null;
  const pools = culturePools(manifest).get(culture);
  if (pools === undefined || pools.calm.length + pools.tense.length === 0) return null;
  return { culture, pools, variants };
}
