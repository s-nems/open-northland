import { z } from 'zod';

/** Source location classification, not a redistribution licence. Absent legacy provenance is unknown. */
export const MapProvenance = z.strictObject({
  kind: z.enum(['base', 'mod', 'user', 'unknown']),
  /** Source-root-relative folder, never a machine-specific installation path. */
  folder: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes(':') &&
        value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
      { message: 'expected a relative map folder' },
    ),
  layer: z.enum(['game', 'mod', 'archive']),
});
export type MapProvenance = z.infer<typeof MapProvenance>;
