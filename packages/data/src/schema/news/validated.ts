import { z } from 'zod';

/** A validation outcome that carries its reason instead of throwing. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** Parses `raw` with `schema`; a failure reads as one line of each issue's path and message. */
export function validated<T>(schema: z.ZodType<T>, raw: unknown): Validated<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = parsed.error.issues
    .map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return { ok: false, reason };
}

/** Absolute `https:` only: the menu opens it in the player's browser. */
export const httpsUrl = z.url({ protocol: /^https$/ });
