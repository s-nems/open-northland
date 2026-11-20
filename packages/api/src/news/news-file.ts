import type { Stats } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';
import { EMPTY_NEWS_DOCUMENT, type NewsDocument, type Validated } from '@open-northland/data';
import { type Body, jsonBody } from '../catalog/snapshot.js';
import type { Log } from '../catalog/thumbnails.js';
import { errorMessage } from '../log.js';
import { newsSizeProblem, parseNewsBytes } from './document.js';

const MISSING = 'missing';
const EMPTY_BODY = jsonBody(EMPTY_NEWS_DOCUMENT);

/** The change time also moves on a chmod or chown, so a permission fix is read again, and on a copy
 *  that keeps the size and the modification time. */
function identityOf(stats: Stats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** A path the server cannot even stat keeps one identity per error code, so it is logged once. */
function unreadable(error: unknown): string {
  return `unreadable:${error instanceof Error && 'code' in error ? String(error.code) : errorMessage(error)}`;
}

/**
 * The news file, read again whenever its identity (inode, size, modification and change time)
 * changes, so an edit or an atomic rename shows on the next request. An invalid or unreadable file
 * keeps the last good news and is logged once per identity. A missing file serves no news, and its
 * old news does not come back after it.
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
    const identity = await this.identityNow();
    if (identity === this.identity) return this.body;
    // Another request may have started the reload while this one waited for its stat.
    if (this.loading !== null) return this.loading;
    this.loading = this.reload(identity).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async identityNow(): Promise<string> {
    try {
      return identityOf(await stat(this.path));
    } catch (error) {
      return isMissing(error) ? MISSING : unreadable(error);
    }
  }

  /** `statIdentity` is the identity the request saw, which a file that cannot be opened keeps. */
  private async reload(statIdentity: string): Promise<Body> {
    let handle: FileHandle;
    try {
      handle = await open(this.path);
    } catch (error) {
      if (!isMissing(error)) return this.refuse(statIdentity, errorMessage(error));
      this.identity = MISSING;
      this.lastGood = EMPTY_BODY;
      this.body = EMPTY_BODY;
      return this.body;
    }
    let identity = statIdentity;
    try {
      const stats = await handle.stat();
      identity = identityOf(stats);
      const tooLarge = newsSizeProblem(stats.size);
      const result: Validated<NewsDocument> =
        tooLarge === null ? parseNewsBytes(await handle.readFile()) : { ok: false, reason: tooLarge };
      if (!result.ok) return this.refuse(identity, result.reason);
      this.identity = identity;
      this.lastGood = jsonBody(result.value);
      this.body = this.lastGood;
      return this.body;
    } catch (error) {
      return this.refuse(identity, errorMessage(error));
    } finally {
      await handle.close();
    }
  }

  private refuse(identity: string, reason: string): Body {
    this.identity = identity;
    this.body = this.lastGood;
    this.log('news refused', { file: this.path, reason });
    return this.body;
  }
}
