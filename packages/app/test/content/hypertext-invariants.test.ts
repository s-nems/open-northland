import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type HypertextBlock, HypertextBook, MapBriefing } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from './helpers.js';

/**
 * Cross-file invariants for the decoded hypertext the mission window renders: the briefing sidecars
 * and the history books parse, carry no empty page, name only pictures the same run emitted, and link
 * only to pages of their own book; a map picture names a node of its own map's half-cell lattice. The
 * decoder's line, underscore and picture heuristics are proved against synthetic pages elsewhere; this
 * is the hold against the real corpus. Skips without generated content (see `helpers.ts`).
 */

/** The `<usericon:…>` kind the mission window draws as the map around half-cell node (a, b). */
const ICON_MAP_AT_NODE = 1;

function pictureFile(file: string): string {
  return resolve(contentDir(), 'gui', 'hypertext', file);
}

function textOf(block: HypertextBlock): string | null {
  return block.kind === 'text' ? block.text : null;
}

describe.runIf(hasRealIr())('decoded hypertext', () => {
  it('emits no empty briefing page, and every picture a page names', () => {
    const dir = resolve(contentDir(), 'maps');
    const files = readdirSync(dir).filter((f) => f.endsWith('.briefing.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const briefing = MapBriefing.parse(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      for (const [lang, pages] of Object.entries(briefing.texts)) {
        for (const [id, blocks] of Object.entries(pages)) {
          const where = `${file} ${lang}/${id}`;
          expect(blocks.length, where).toBeGreaterThan(0);
          expect(
            blocks.some((b) => (textOf(b) ?? '').trim() !== '' || b.kind === 'picture' || b.kind === 'icons'),
            where,
          ).toBe(true);
          for (const block of blocks) {
            if (block.kind === 'picture') expect(existsSync(pictureFile(block.file)), where).toBe(true);
          }
        }
      }
    }
  });

  it('names map pictures by a node inside their map, most of them past its cell grid', () => {
    const dir = resolve(contentDir(), 'maps');
    let pictures = 0;
    let pastCellGrid = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.briefing.json'))) {
      const briefing = MapBriefing.parse(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      const map = JSON.parse(readFileSync(resolve(dir, file.replace('.briefing.json', '.json')), 'utf8'));
      const { width, height } = map as { width: number; height: number };
      for (const pages of Object.values(briefing.texts)) {
        for (const blocks of Object.values(pages)) {
          for (const block of blocks) {
            if (block.kind !== 'icons') continue;
            for (const [kind, hx, hy] of block.icons) {
              if (kind !== ICON_MAP_AT_NODE) continue;
              pictures++;
              if (hx >= width || hy >= height) pastCellGrid++;
              expect(hx < 2 * width && hy < 2 * height, `${file} node (${hx}, ${hy})`).toBe(true);
            }
          }
        }
      }
    }
    // A cell address would stay inside the cell grid; the corpus leaves it for most pictures.
    expect(pastCellGrid).toBeGreaterThan(pictures / 2);
  });

  it('opens each history book on a page it holds and links only inside it', () => {
    const dir = resolve(contentDir(), 'gui', 'history');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const book = HypertextBook.parse(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      expect(Object.keys(book.pages), file).toContain(book.start);
      for (const [id, blocks] of Object.entries(book.pages)) {
        const where = `${file} ${id}`;
        expect(blocks.length, where).toBeGreaterThan(0);
        for (const block of blocks) {
          if (block.kind === 'picture') expect(existsSync(pictureFile(block.file)), where).toBe(true);
          else if (block.kind === 'text' && block.link !== undefined) {
            expect(Object.keys(book.pages), where).toContain(block.link);
          }
        }
      }
    }
  });
});
