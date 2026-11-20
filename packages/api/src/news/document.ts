import {
  NEWS_FILE_MAX_BYTES,
  type NewsDocument,
  type Validated,
  validateNewsDocument,
} from '@open-northland/data';
import { errorMessage } from '../log.js';

/** Where the news lives in the API's data directory. */
export const NEWS_FILE_NAME = 'news.json';

/** Why a news file of `size` bytes is refused unread, or null when it may be read. */
export function newsSizeProblem(size: number): string | null {
  return size > NEWS_FILE_MAX_BYTES
    ? `file is ${size} bytes, over the ${NEWS_FILE_MAX_BYTES}-byte cap`
    : null;
}

/** Judges a news file's bytes as the server and the check CLI both read them. */
export function parseNewsBytes(bytes: Uint8Array): Validated<NewsDocument> {
  const tooLarge = newsSizeProblem(bytes.length);
  if (tooLarge !== null) return { ok: false, reason: tooLarge };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    return { ok: false, reason: `not JSON: ${errorMessage(error)}` };
  }
  return validateNewsDocument(raw);
}
