import { type ContentSet, contentFingerprint } from '@open-northland/data';

/** A sim's content set never changes after construction, and hashing a real one costs tens of
 *  milliseconds: once per set is enough for every save, snapshot and restore over it. */
const fingerprints = new WeakMap<ContentSet, string>();

export function simContentFingerprint(content: ContentSet): string {
  const known = fingerprints.get(content);
  if (known !== undefined) return known;
  const fingerprint = contentFingerprint(content);
  fingerprints.set(content, fingerprint);
  return fingerprint;
}
