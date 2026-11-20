import type { Stats } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';
import { EMPTY_NEWS_DOCUMENT, type NewsDocument, type Validated } from '@open-northland/data';
import { type Body, jsonBody } from '../catalog/snapshot.js';
import type { Log } from '../catalog/thumbnails.js';
import { errorMessage } from '../log.js';
import { newsSizeProblem, parseNewsBytes } from './document.js';

const MISSING = 'missing';
const EMPTY_BODY = jsonBody(EMPTY_NEWS_DOCUMENT);

function identityOf(stats: Stats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The news file, read again whenever its identity (inode, size, mtime) changes, so an edit or an
 * atomic rename shows on the next request. An invalid file keeps the last good news and is logged
 * once per identity. A missing file serves no news.
 */
export class NewsFile {
  private identity: string | null = null;
  private body: Body = EMPTY_BODY;
  private lastGood: Body = EMPTY_BODY;
  /** The reload in flight, which concurrent requests share. */
  private loading: Promise<Body> | null = null;

  constructor(
    private readonly path: string,
    private readonly log: Log,
  ) {}

  async current(): Promise<Body> {
    if (this.loading !== null) return this.loading;
    let identity: string;
    try {
      identity = identityOf(await stat(this.path));
    } catch (error) {
      if (!isMissing(error)) throw error;
      identity = MISSING;
    }
    if (identity === this.identity) return this.body;
    this.loading = this.reload().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async reload(): Promise<Body> {
    let handle: FileHandle;
    try {
      handle = await open(this.path);
    } catch (error) {
      if (!isMissing(error)) throw error;
      this.identity = MISSING;
      this.body = EMPTY_BODY;
      return this.body;
    }
    try {
      const stats = await handle.stat();
      this.identity = identityOf(stats);
      const tooLarge = newsSizeProblem(stats.size);
      const result: Validated<NewsDocument> =
        tooLarge === null ? parseNewsBytes(await handle.readFile()) : { ok: false, reason: tooLarge };
      if (result.ok) {
        this.lastGood = jsonBody(result.value);
        this.body = this.lastGood;
      } else {
        this.body = this.lastGood;
        this.log('news refused', { file: this.path, reason: result.reason });
      }
    } catch (error) {
      this.body = this.lastGood;
      this.log('news refused', { file: this.path, reason: errorMessage(error) });
    } finally {
      await handle.close();
    }
    return this.body;
  }
}
