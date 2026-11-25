import { type HypertextBlock, isLanguage, type MapTextLanguage } from '@open-northland/data';
import { GOAL_EMPHASIS_MARK, type MissionPage, type MissionReader } from '../../game/map/mission-brief.js';
import type { LocalizedMapString } from '../../game/map/strings.js';
import { bcp47Tag, type Locale } from '../index.js';
import { readsForeign } from './pairs.js';

/**
 * The bridge between a world's mission texts and the device translator: pages, goals and the map
 * name a map ships in a language the reader does not read are translated in place, once each. The
 * reader keeps answering the original text until a translation lands, so the book shows the map's
 * own words first and never blocks a game on the device's work.
 */

/** The device translator the bridge works through; the app's service answers this shape. */
export interface TextTranslator {
  translate(texts: readonly string[], from: MapTextLanguage, to: MapTextLanguage): Promise<readonly string[]>;
}

/** What a window's translate control chooses: the reader's own language, the map's original, or a
 *  language to read the map in. */
export type TranslateChoice = 'auto' | 'original' | Locale;

export interface MissionTranslatorDeps {
  /** The language the texts translate into, read again on every text; null keeps them as authored —
   *  so a window can offer the original and a reading language of its own, and a change of answer
   *  retargets the bridge live. */
  readonly target: () => Locale | null;
  /** Whether the option is on; off, every text keeps the language it was authored in. */
  readonly enabled: () => boolean;
  readonly translator: TextTranslator;
  /** Called once the next translations land, so the open views rebuild. */
  readonly onChange: () => void;
}

export interface MissionTranslator {
  /** Bumped whenever a translation landed or the target changed; view deps join it into their
   *  rebuild keys. */
  version(): number;
  /** Re-reads the target now, so a change of choice drops what the old target built and bumps the
   *  version even before the next text is read. */
  retarget(): void;
  /** Wraps the world's mission reader: pages and the mission name come out translated. */
  reader(reader: MissionReader): MissionReader;
  /** Wraps the map's string lookup, so goal texts come out translated. */
  textOf(
    lookup: (stringId: number) => LocalizedMapString | undefined,
  ): (stringId: number) => string | undefined;
  /** Translates one localized map text in place — a seat's authored name, say — keeping the original
   *  until the translation lands; a text the reader's own (non-English) fallbacks answered passes
   *  as it is. */
  text(found: LocalizedMapString): string;
  /** Stops reading the translator; nothing queues on it afterwards. */
  dispose(): void;
}

/** The cache key a failed batch keeps the original for before the next read may queue it again:
 *  long enough that a dead engine or a dropped download is not retried in a tight loop, short
 *  enough that a transient failure does not pin a text to the original for the whole session. */
const FAILED_RETRY_MS = 30_000;

/** The one text of a paragraph block, or null for a block that carries none. */
const textOfBlock = (block: HypertextBlock): string | null => (block.kind === 'text' ? block.text : null);

/** A foreign string's cache key, per target language: two readers of one text keep their answers
 *  apart, and a target change never serves what another target translated. */
const keyOf = (to: Locale, from: MapTextLanguage, text: string): string => `${to}:${from}:${text}`;

export function createMissionTranslator(deps: MissionTranslatorDeps): MissionTranslator {
  /** Translations that landed, by `to:from:text`. */
  const done = new Map<string, string>();
  /** The foreign strings queued for the next flush, by cache key. */
  const queued = new Map<string, MapTextLanguage>();
  /** Cache keys whose batch is with the translator right now. The next rebuild does not re-queue
   *  them: a landing bumps the version and rebuilds the views before its own texts are in `done`,
   *  and without this set every rebuild while a batch runs would pile one duplicate engine call
   *  after another onto it. */
  const inflight = new Set<string>();
  /** Cache keys whose batch failed, by when it did. A failed key keeps the original for a while —
   *  so a dying worker, a dropped download cannot pin a text to the original for the whole session
   *  — and may queue again once the engine had time to recover. */
  const failed = new Map<string, number>();
  /** What a target change drops: a reader's derived pages answer only one target. */
  const drops: (() => void)[] = [];
  let version = 0;
  let disposed = false;
  /** The target the caches answer, or undefined before the first read; a change clears what would
   *  go stale. */
  let served: Locale | null | undefined;

  /** The target to read by now; a change flushes the queues and drops what the old target built. */
  const targetOf = (): Locale | null => {
    const to = deps.target();
    if (served !== undefined && to !== served) {
      queued.clear();
      failed.clear();
      for (const drop of drops) drop();
      version++;
      deps.onChange();
    }
    served = to;
    return to;
  };

  const flush = (): void => {
    if (disposed || queued.size === 0) return;
    const to = targetOf();
    if (to === null) return;
    const batch = [...queued.entries()];
    queued.clear();
    for (const [key] of batch) inflight.add(key);
    // One engine call per source language: a map's pages read in one language, but a save's goal
    // strings may come from a table in another.
    for (const from of new Set(batch.map(([, lang]) => lang))) {
      const texts = batch
        .filter(([, lang]) => lang === from)
        .map(([key]) => key.slice(to.length + from.length + 2));
      void deps.translator
        .translate(texts, from, to)
        .then((translated) => {
          if (disposed) return;
          for (const [index, text] of translated.entries()) {
            const key = keyOf(to, from, texts[index] ?? '');
            inflight.delete(key);
            done.set(key, text);
          }
          version++;
          deps.onChange();
        })
        .catch(() => {
          for (const text of texts) {
            const key = keyOf(to, from, text);
            inflight.delete(key);
            failed.set(key, Date.now());
          }
          version++;
          deps.onChange();
        });
    }
  };

  /** Reads `text` in `from` through the cache, queueing it for the next flush the first time. A key
   *  already with the translator waits for its batch instead of ordering a duplicate; a key whose
   *  batch failed recently keeps the original until the retry cooldown is over. */
  const read = (from: MapTextLanguage, text: string, to: Locale | null): string => {
    if (to === null) return text;
    const key = keyOf(to, from, text);
    const known = done.get(key);
    if (known !== undefined) return known;
    if (!queued.has(key) && !inflight.has(key)) {
      const failedAt = failed.get(key);
      if (failedAt === undefined || Date.now() - failedAt >= FAILED_RETRY_MS) failed.delete(key);
      else return text;
      queued.set(key, from);
      queueMicrotask(flush);
    }
    return text;
  };

  return {
    version: () => version,
    retarget: () => {
      targetOf();
    },
    textOf: (lookup) => (stringId) => {
      const found = lookup(stringId);
      if (found === undefined) return undefined;
      const to = targetOf();
      // A string the reader's own fallbacks answered — a Simplified page for a Traditional Chinese
      // reader — is theirs by choice, not foreign text to translate. English never qualifies: the
      // table nearly every map falls back to must translate for every other reader.
      if (found.lang === null || to === null || !deps.enabled() || !readsForeign(found.lang, to)) {
        return found.text;
      }
      // The author's leading mark names a goal's emphasis; the engine translates the words only, and
      // the mark goes back on so the goal list reads it.
      if (found.text.startsWith(GOAL_EMPHASIS_MARK)) {
        const words = found.text.slice(GOAL_EMPHASIS_MARK.length).trim();
        if (words === '') return found.text;
        return GOAL_EMPHASIS_MARK + read(found.lang, words, to);
      }
      return read(found.lang, found.text, to);
    },
    text: (found) => {
      const to = targetOf();
      // A name the reader's own fallbacks answered is theirs by choice, not foreign text to translate.
      if (found.lang === null || to === null || !deps.enabled() || !readsForeign(found.lang, to)) {
        return found.text;
      }
      return read(found.lang, found.text, to);
    },
    reader: (base) => {
      /** The translated page over a base page, kept only once every text of that page has landed: a
       *  page read before its batch answers re-derives, so it never serves a half or stale state. A
       *  target change drops it — a page answers the target it was built for. */
      const pages = new Map<readonly HypertextBlock[], MissionPage>();
      drops.push(() => pages.clear());

      const pageOf = (page: number | null): MissionPage => {
        const found = base.page(page);
        const to = targetOf();
        if (!deps.enabled() || to === null || !isLanguage(found.lang) || !readsForeign(found.lang, to)) {
          return found;
        }
        const from = found.lang;
        const cached = pages.get(found.blocks);
        if (cached !== undefined) return cached;
        const title = found.title === '' ? '' : read(from, found.title, to);
        const blocks = found.blocks.map((block) => {
          const text = textOfBlock(block);
          return text === null ? block : { ...block, text: read(from, text, to) };
        });
        const translated: MissionPage = {
          ...found,
          title,
          blocks,
          /** Narration and callbacks stay the map's own language; the prose reads in the target's. */
          proseLang: bcp47Tag(to),
        };
        if (
          found.blocks.every((block) => {
            const text = textOfBlock(block);
            return text === null || done.has(keyOf(to, from, text));
          })
        ) {
          pages.set(found.blocks, translated);
        }
        return translated;
      };

      return {
        page: pageOf,
        // The goal texts pass through the wrapped string lookup above; the list follows it live.
        goals: () => base.goals(),
        // The book prints the map's name over its chapters: the translated fallback page's title.
        get missionName() {
          return pageOf(null).title;
        },
      };
    },
    dispose() {
      disposed = true;
      queued.clear();
    },
  };
}
