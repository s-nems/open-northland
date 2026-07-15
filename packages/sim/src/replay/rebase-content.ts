import { type ContentSet, parseContentSet } from '@open-northland/data';
import type { LoggedCommand } from '../core/command-queue.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import type { Simulation } from '../simulation.js';
import { replay } from './replay.js';

/**
 * Content hot-reload — the headless, self-verifiable half of the "Content hot-reload" DX win.
 *
 * Content is validated JSON injected into the sim (golden rule 3, content-is-data). When a designer
 * edits a balance file, we want the running settlement to pick up the new numbers WITHOUT a rebuild
 * and WITHOUT losing the in-progress run. This is the pure core of that: given the running sim's
 * reconstruction inputs `(seed, map?, log)` and a freshly-read RAW content blob, it **validates** the
 * new content and, if valid, **rebases** the run onto it — replaying the recorded command log into a
 * FRESH `Simulation` built with the NEW `ContentSet`, so the rebuilt run carries the same player
 * history forward under the new rules.
 *
 * It is render-agnostic and pure (no DOM, no Pixi, no `fs`): the app reads the file and watches it
 * (the Vite-HMR glue is a `render`/`app` concern), then calls THIS — the part an agent can
 * self-verify headlessly. Its determinism oracle is the same as {@link replay}: rebasing onto the
 * SAME content reproduces the original run byte-for-byte (`hashState()` equality), so the only thing
 * a rebase changes is what the new data dictates.
 *
 * ## Why a full replay, not an in-place content swap
 *
 * `Simulation.content` is read at construction (the terrain graph) and on every `step()` (the system
 * context), so a state mid-run is the product of EVERY past tick's content, not just the current
 * tick's. Mutating `content` on a live sim would leave all prior ticks computed under the old rules —
 * a Frankenstein state no clean run could reach, breaking determinism (two designers reaching the
 * same content via different edit paths would diverge). Replaying the command log from tick 1 under
 * the new content is the only rebase that yields a state a fresh run could also produce. (This is the
 * deterministic-rebase price; an app may instead apply new content only to FUTURE ticks, which needs
 * no replay — a different, also-valid policy the app layer chooses.)
 *
 * The rebuilt sim is independent of the original (each `replay()` owns its stores), so both stay valid
 * side by side. On an `error` result NOTHING is rebuilt: the bad content never reached a `Simulation`,
 * so the original sim is untouched and the caller keeps using it.
 */
export interface RebaseInputs {
  /** The seed the running sim was constructed with — replay must reuse it or state diverges. */
  readonly seed: number;
  /** The terrain map the running sim used, if any — replay must rebuild the SAME graph. */
  readonly map?: TerrainMap;
  /** The running sim's command log (`Simulation.commands.log`) — the history to carry forward. */
  readonly log: readonly LoggedCommand[];
  /**
   * Reconstruct as of the END of this tick (inclusive). Pass the running sim's `tick` to land the
   * rebased run at the SAME tick the live sim is on (so the rebase is invisible but for the new
   * rules). Defaults, like {@link replay}, to the last logged tick. A negative target is a caller
   * bug and throws (via `replay`).
   */
  readonly untilTick?: number;
}

/**
 * The outcome of a content hot-reload. Bad content is an EXPECTED boundary failure (a designer can
 * save a half-edited or malformed file), so it is a typed result, not a throw — AGENTS.md "throw for
 * bugs, return for expected failures". A discriminated union (`assertNever`-friendly) so a caller's
 * switch is exhaustive: `ok` carries the rebased `Simulation`; `error` carries the validation message
 * (zod path or cross-reference error) and the original sim is left untouched.
 *
 * `ok.content` is the SAME `ContentSet` reference the rebased `sim` was built with (`sim.content ===
 * content`) — surfaced here only so a caller can record "the now-current content" without reaching
 * into the sim, not a second copy.
 */
export type RebaseResult =
  | { readonly kind: 'ok'; readonly sim: Simulation; readonly content: ContentSet }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Validate `rawContent` and, if it is a well-formed `ContentSet`, rebase the run described by
 * `inputs` onto it (replay the log from tick 1 under the new content to `untilTick`). Returns a
 * `{kind:'error'}` with the validation message when the content is malformed — the original sim is
 * NOT disturbed in that case (no `Simulation` is built). Throws only on a caller bug (a negative
 * `untilTick`, surfaced by `replay`); a programmer error, not bad content.
 */
export function rebaseContent(rawContent: unknown, inputs: RebaseInputs): RebaseResult {
  let content: ContentSet;
  try {
    // parseContentSet runs the zod schema AND the cross-reference pass; either throws on bad input.
    // A malformed reload is recoverable (the designer just re-saves), so we convert the throw into a
    // typed error rather than letting it escape — the live sim stays usable.
    content = parseContentSet(rawContent);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  // Content is valid → rebuild the run on it in a fresh Simulation, so an invalid reload above never
  // perturbs the original sim.
  const sim = replay({
    content,
    seed: inputs.seed,
    ...(inputs.map !== undefined ? { map: inputs.map } : {}),
    log: inputs.log,
    ...(inputs.untilTick !== undefined ? { untilTick: inputs.untilTick } : {}),
  });
  return { kind: 'ok', sim, content };
}
