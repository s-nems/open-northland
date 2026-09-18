import { existsSync, readFileSync } from 'node:fs';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutRoot } from '../test/support/checkout-root.js';

/**
 * Where a profiled call frame lives, as a developer would go looking for it. V8 reports the built
 * `dist/*.js` the benchmark actually runs, so each frame is mapped back through the `.js.map` tsc
 * already emits beside it and reported repo-relative. A frame without a usable map keeps its built
 * path rather than guessing a source line.
 */

const FILE_SCHEME = 'file://';
/** V8 call frames count lines from 0; a location a reader can paste counts from 1. */
const FIRST_LINE = 1;

export interface SourceLocation {
  readonly file: string;
  /** 1-based, or 0 for a frame with no line (native code, the profiler's own roots). */
  readonly line: number;
}

export function formatLocation(location: SourceLocation): string {
  return location.line === 0 ? location.file : `${location.file}:${location.line}`;
}

const mapCache = new Map<string, SourceMap | null>();

function sourceMapFor(path: string): SourceMap | null {
  const cached = mapCache.get(path);
  if (cached !== undefined) return cached;
  const mapPath = `${path}.map`;
  let map: SourceMap | null = null;
  if (existsSync(mapPath)) {
    try {
      map = new SourceMap(JSON.parse(readFileSync(mapPath, 'utf8')) as SourceMapPayload);
    } catch {
      // A truncated or foreign map is not worth failing a benchmark over; the built path still names
      // the frame.
      map = null;
    }
  }
  mapCache.set(path, map);
  return map;
}

/** The mapped source, resolved against the map file that named it, or null when nothing matched. */
function mappedSource(path: string, line: number, column: number): SourceLocation | null {
  const map = sourceMapFor(path);
  if (map === null) return null;
  const entry = map.findEntry(line, column);
  if (!('originalSource' in entry)) return null;
  const source = entry.originalSource;
  const file = source.startsWith(FILE_SCHEME) ? fileURLToPath(source) : resolve(dirname(path), source);
  return { file: repoRelative(file), line: entry.originalLine + FIRST_LINE };
}

function repoRelative(path: string): string {
  const rel = relative(checkoutRoot(), path);
  return rel.startsWith('..') ? path : rel;
}

/**
 * Resolve one V8 call frame. `url` is empty for native frames and the profiler's own root nodes, and
 * a non-`file:` url (Node internals) is reported as V8 spells it.
 */
export function resolveLocation(url: string, lineNumber: number, columnNumber: number): SourceLocation {
  if (url === '') return { file: '(native)', line: 0 };
  if (!url.startsWith(FILE_SCHEME)) return { file: url, line: lineNumber + FIRST_LINE };
  const path = fileURLToPath(url);
  return (
    mappedSource(path, lineNumber, columnNumber) ?? {
      file: repoRelative(path),
      line: lineNumber + FIRST_LINE,
    }
  );
}
