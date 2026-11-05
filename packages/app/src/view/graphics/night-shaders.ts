import {
  drawNightMaskPrograms,
  type GlslProgramSource,
  nightMaskSources,
  type RendererLink,
  type WarmedProgram,
} from '@open-northland/render';
import type { Renderer } from 'pixi.js';
import { diag } from '../../diag/log.js';
import { readStoredSettings } from '../settings/store.js';

/** Where the fingerprint of the night programs last drawn ahead to the end is kept. */
const DRAWN_KEY = 'open-northland.night-programs-drawn';
/** A link at least this long compiled rather than came from the browser's program cache, which answers
 *  within a few hundred ms even beside the warm-up's other links; a cold Direct3D link of a world batch
 *  program takes seconds. */
const COMPILED_LINK_MS = 1000;
/** FNV-1a, 32 bits. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_RADIX = 16;

/** How this page's links of the stored settings' programs went: the warm-up's, then the renderer's own. */
export interface ProgramLinkTimes {
  readonly warmed: readonly WarmedProgram[];
  readonly linked: readonly RendererLink[];
}

/** The night programs this page drew ahead, by fingerprint: the program cache holds their variants. */
let drawnThisPage: string | null = null;

/**
 * Draws the stored settings' night-mask programs once in a game's renderer, after its programs linked
 * and before its first frame, so the first night does not compile them. Skipped where the program cache
 * already holds their two-output variants: drawn in this page, or drawn in an earlier boot and linked
 * from the cache now. Drawn again wherever a link compiled, since a cache cleared or replaced (another
 * browser version, driver or GPU) lost the variants the stored fingerprint vouches for. A failure is
 * logged and the boot goes on: the first night then compiles them as it would have. `announce` runs
 * before draws that are due, so the loading card names what its stopped frames wait for.
 */
export async function drawNightShaders(
  renderer: Renderer,
  links: ProgramLinkTimes,
  announce: () => Promise<void>,
): Promise<void> {
  try {
    const sources = nightMaskSources(renderer, readStoredSettings());
    if (sources.length === 0) return;
    const fingerprint = fingerprintOf(sources);
    if (
      drawnThisPage === fingerprint ||
      (!compiledInThisPage(sources, links) && storedFingerprint() === fingerprint)
    ) {
      diag.info('boot', 'night programs already drawn', { programs: sources.length });
      return;
    }
    await announce();
    const drawn = await drawNightMaskPrograms(renderer, sources);
    if (drawn === null) return;
    diag.info('boot', 'night programs drawn', { programs: drawn.programs, ms: Math.round(drawn.ms) });
    if (drawn.timedOut) {
      diag.warn('boot', 'night program draws still with the GPU when the boot went on');
      return;
    }
    drawnThisPage = fingerprint;
    storeFingerprint(fingerprint);
  } catch (err) {
    diag.warn('boot', 'night program draws failed', err);
  }
}

/** Whether any of `sources` compiled in this page, or its link is unaccounted for. */
function compiledInThisPage(sources: readonly GlslProgramSource[], links: ProgramLinkTimes): boolean {
  return sources.some((source) => {
    const warmed = links.warmed.find((program) => program.name === source.name);
    if (warmed !== undefined && (warmed.outcome !== 'linked' || warmed.ms >= COMPILED_LINK_MS)) return true;
    const linked = links.linked.find((link) => link.name === source.name);
    return linked === undefined || linked.ms >= COMPILED_LINK_MS;
  });
}

function fingerprintOf(sources: readonly GlslProgramSource[]): string {
  let hash = FNV_OFFSET;
  for (const source of sources) {
    for (const text of [source.name, source.vertex, source.fragment]) {
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME);
    }
  }
  return (hash >>> 0).toString(HEX_RADIX);
}

/** Storage may be missing or refuse access; either answers as never drawn. */
function storedFingerprint(): string | null {
  try {
    return window.localStorage.getItem(DRAWN_KEY);
  } catch {
    return null;
  }
}

function storeFingerprint(fingerprint: string): void {
  try {
    window.localStorage.setItem(DRAWN_KEY, fingerprint);
  } catch {
    // Unstored, the next boot draws them again.
  }
}
