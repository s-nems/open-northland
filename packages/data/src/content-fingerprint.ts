import { jsonFingerprint } from './json-fingerprint.js';
import type { ContentSet } from './schema/content/content-set.js';

/** Paths, locale and display names do not identify simulation content. Revision is checked separately. */
export function contentFingerprint(content: ContentSet): string {
  const { manifest, maps: _maps, sounds: _sounds, ...tables } = content;
  return jsonFingerprint({
    format: 'open-northland-content-1',
    irVersion: manifest.version,
    tables: Object.fromEntries(
      Object.entries(tables).map(([table, rows]) => [
        table,
        rows.map((row: Record<string, unknown>) => {
          const { source: _source, ...fields } = row;
          if (table === 'goods' || table === 'jobs') delete fields.name;
          return fields;
        }),
      ]),
    ),
  });
}
