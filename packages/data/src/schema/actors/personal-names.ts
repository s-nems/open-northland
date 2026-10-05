import { z } from 'zod';

export const PersonalNamePool = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
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
