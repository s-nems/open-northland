import { z } from 'zod';
import { httpsUrl, type Validated, validated } from './validated.js';

/**
 * The website's `releases/feed.json`, newest release first. Objects strip unknown keys: the site
 * deploys apart from the game, and an older game must keep reading a feed that grew a field.
 */
export const RELEASE_FEED_SCHEMA_VERSION = 1;

/** Pages keyed by the site's language tags, which match the game languages' `LANGUAGE_INFO` tags;
 *  every page exists in English. */
export const SiteLinks = z.object({ en: httpsUrl }).catchall(httpsUrl);
export type SiteLinks = z.infer<typeof SiteLinks>;

/** `major.minor.patch` with an optional prerelease suffix. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const FeedRelease = z.object({
  version: z.string().regex(RELEASE_VERSION),
  /** The release's calendar date, `YYYY-MM-DD`. */
  date: z.iso.date(),
  url: SiteLinks,
});
export type FeedRelease = z.infer<typeof FeedRelease>;

export const ReleaseFeed = z.object({
  schema: z.literal(RELEASE_FEED_SCHEMA_VERSION),
  download: SiteLinks,
  releases: z.array(FeedRelease),
});
export type ReleaseFeed = z.infer<typeof ReleaseFeed>;

export function validateReleaseFeed(raw: unknown): Validated<ReleaseFeed> {
  return validated(ReleaseFeed, raw);
}
