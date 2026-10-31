import { z } from 'zod';

/** A personal-name pool id: lowercase words, as `PERSONAL_NAMES` spells them and as the file name of a
 *  `names` translation overlay repeats them. */
export const PersonalNamePoolId = z.string().regex(/^[a-z][a-z0-9-]*$/);
export type PersonalNamePoolId = z.infer<typeof PersonalNamePoolId>;

export const PersonalNamePool = z.strictObject({
  id: PersonalNamePoolId,
  tribe: z.number().int().positive(),
  sex: z.enum(['male', 'female', 'neutral']),
  names: z
    .array(
      z
        .string()
        .min(1)
        .max(32)
        .refine(
          (name) => name === name.trim() && name === name.normalize('NFC') && !/[\p{Cc}\p{Cf}\s]/u.test(name),
          'Names must be normalized single words without control characters',
        ),
    )
    .min(1)
    .refine(
      (names) => new Set(names.map((name) => name.toLowerCase())).size === names.length,
      'Names must be unique within a pool',
    ),
});
export type PersonalNamePool = z.infer<typeof PersonalNamePool>;
