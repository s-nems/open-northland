import { type ContentSet, parseContentSet } from '@open-northland/data';
import { fetchJsonOrNull } from './net.js';

/** The one in-flight/settled parse of the served IR into a `ContentSet` — memoized like {@link loadRealContent}. */
let contentSetPromise: Promise<ContentSet | null> | null = null;

/**
 * Fetch + validate the served `content/ir.json` into the sim's `ContentSet` — the real-content
 * counterpart to {@link import('./ir.js').loadIr}, which returns the graphics/atlas view instead. The
 * pure sim never does I/O, so the validated set is minted here at the app boundary
 * (`packages/app/AGENTS.md`); wiring it into the sim is a later ticket.
 *
 * Returns `null` when `content/` is absent, so a bare checkout still boots; a present-but-malformed IR
 * throws via `parseContentSet` so a genuine schema or cross-reference break surfaces loudly instead of
 * degrading to silence. `fetchImpl` defaults to the global `fetch`; the default path is memoized (the
 * multi-MB IR parses once per page), while an injected transport runs uncached so callers stay
 * independent.
 */
export function loadRealContent(fetchImpl: typeof fetch = fetch): Promise<ContentSet | null> {
  if (fetchImpl !== fetch) return fetchContentSet(fetchImpl);
  contentSetPromise ??= fetchContentSet(fetch).then((set) => {
    // Memoize only success: a transient boot-time fetch failure must not pin the loader to null for
    // the page's lifetime — the next consumer retries (mirrors loadIr).
    if (set === null) contentSetPromise = null;
    return set;
  });
  return contentSetPromise;
}

async function fetchContentSet(fetchImpl: typeof fetch): Promise<ContentSet | null> {
  const raw = await fetchJsonOrNull<unknown>('/ir.json', fetchImpl);
  return raw === null ? null : parseContentSet(raw);
}
