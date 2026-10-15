import { z } from 'zod';
import { MAP_TEXT_LANGUAGES } from './strings.js';

const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(128);
const MovieAsset = z.string().regex(/^\/campaigns\/[a-z0-9_/-]+\.(webm|mp4)$/);
const MapAsset = z.string().regex(/^\/campaigns\/[a-z0-9_/-]+\.png$/);
const Slot = z.number().int().nonnegative();
const Language = z.enum(MAP_TEXT_LANGUAGES);
const Movie = z.strictObject({
  url: MovieAsset,
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
});

/** One text in the languages that carry it; at least one does. */
export const LocalizedText = z
  .partialRecord(Language, z.string().min(1))
  .refine((text) => Object.keys(text).length > 0, 'Text has no language');
export type LocalizedText = z.infer<typeof LocalizedText>;

/** The films of one language: the intro before the first stage and the script's numbered videos. */
const LanguageMovies = z
  .strictObject({
    intro: Movie.optional(),
    videos: z.array(Movie.extend({ sequence: Slot })),
  })
  .superRefine((movies, ctx) => {
    const sequences = movies.videos.map((movie) => movie.sequence);
    if (new Set(sequences).size !== sequences.length)
      ctx.addIssue({ code: 'custom', path: ['videos'], message: 'Duplicate video sequence' });
  });
/** The dotted path drawn into a stage from the one before it, placed as fractions of the background. */
const Route = z.strictObject({
  url: MapAsset,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});
export type CampaignRoute = z.infer<typeof Route>;

export type CampaignLanguageMovies = z.infer<typeof LanguageMovies>;

/**
 * One original campaign. Its maps exist once; texts, films and voices are per language, and
 * `languages` lists the text languages every map of the campaign carries. `order` is the display
 * order; submaps belong to maps but never become selectable stages.
 */
export const Campaign = z
  .strictObject({
    id: Id,
    campaignId: Slot,
    order: z.number().int(),
    title: LocalizedText,
    languages: z.array(Language).min(1),
    maps: z.array(z.strictObject({ id: Id, missionId: Slot })).min(1),
    stages: z
      .array(
        z.strictObject({
          mapId: Id,
          title: LocalizedText,
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          route: Route.optional(),
        }),
      )
      .min(1),
    background: MapAsset,
    logo: MapAsset.optional(),
    movies: z.partialRecord(Language, LanguageMovies),
  })
  .superRefine((campaign, ctx) => {
    const unique = (values: readonly (string | number)[], path: string): void => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [path], message: 'Duplicate campaign identity' });
    };
    unique(campaign.languages, 'languages');
    unique(
      campaign.maps.map((map) => map.id),
      'maps',
    );
    unique(
      campaign.maps.map((map) => map.missionId),
      'maps',
    );
    unique(
      campaign.stages.map((stage) => stage.mapId),
      'stages',
    );
    for (const stage of campaign.stages) {
      if (!campaign.maps.some((map) => map.id === stage.mapId))
        ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Stage has no campaign map' });
    }
  });
export type Campaign = z.infer<typeof Campaign>;
export type CampaignMovie = z.infer<typeof Movie>;

export const CampaignIndex = z
  .strictObject({
    version: z.literal(2),
    campaigns: z.array(Campaign),
  })
  .superRefine(({ campaigns }, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    const maps = new Set<string>();
    for (const campaign of campaigns) {
      if (ids.has(campaign.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate campaign id' });
      ids.add(campaign.id);
      if (orders.has(campaign.order)) ctx.addIssue({ code: 'custom', message: 'Duplicate campaign order' });
      orders.add(campaign.order);
      for (const map of campaign.maps) {
        if (maps.has(map.id)) ctx.addIssue({ code: 'custom', message: 'Map belongs to multiple campaigns' });
        maps.add(map.id);
      }
    }
  });
export type CampaignIndex = z.infer<typeof CampaignIndex>;
