import { z } from 'zod';
export const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value.split('/').every((p) => p !== '..' && p !== '.' && p.length > 0),
    'Expected a relative path without traversal',
  );
export const assetId = z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/);
