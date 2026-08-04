import { type ContentSet, parseContentSet } from '@open-northland/data';
import type { Simulation } from '../simulation.js';
import { type ReplayOptions, replay } from './replay.js';

/**
 * Replay inputs minus the content a rebase replaces. Pass the running sim's `tick` as `untilTick` to
 * land the rebased run on the tick the live sim is already on.
 */
export type RebaseInputs = Omit<ReplayOptions, 'content'>;

/**
 * Malformed content is an expected boundary failure, so it is a typed result rather than a throw.
 * `ok.content` is the same `ContentSet` reference the rebased `sim` was built with, not a copy.
 */
export type RebaseResult =
  | { readonly kind: 'ok'; readonly sim: Simulation; readonly content: ContentSet }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Validate `rawContent` and, if it parses, rebuild the run described by `inputs` on it by replaying the
 * log from tick 1. A mid-run state is the product of every past tick's content, so swapping `content` on
 * a live sim would leave earlier ticks computed under the old rules and produce a state no clean run
 * could reach. On an `error` result no `Simulation` is built and the original stays usable.
 */
export function rebaseContent(rawContent: unknown, inputs: RebaseInputs): RebaseResult {
  let content: ContentSet;
  try {
    // parseContentSet runs the zod schema and the cross-reference pass; either throws on bad input.
    content = parseContentSet(rawContent);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  const sim = replay({ ...inputs, content });
  return { kind: 'ok', sim, content };
}
