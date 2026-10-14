import { z } from 'zod';
import { MAP_TEXT_LANGUAGES } from './strings.js';

const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(128);
const MovieAsset = z.string().regex(/^\/campaigns\/[a-z0-9_/-]+\.(webm|mp4)$/);
const MapAsset = z.string().regex(/^\/campaigns\/[a-z0-9_/-]+\.png$/);
const Slot = z.number().int().nonnegative();
const Movie = z.strictObject({
  url: MovieAsset,
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
});

/** Explicit authored order; submaps belong to maps but never become selectable stages. */
export const Campaign = z
  .strictObject({
    id: Id,
    language: z.enum(MAP_TEXT_LANGUAGES),
    title: z.string().min(1),
    campaignId: Slot,
    maps: z.array(z.strictObject({ id: Id, missionId: Slot })).min(1),
    stages: z
      .array(
        z.strictObject({
          mapId: Id,
          title: z.string().min(1),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
      )
      .min(1),
    background: MapAsset,
    intro: Movie.optional(),
    videos: z.array(Movie.extend({ sequence: Slot })),
  })
  .superRefine((campaign, ctx) => {
    const unique = (values: readonly (string | number)[], path: string): void => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [path], message: 'Duplicate campaign identity' });
    };
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
    unique(
      campaign.videos.map((movie) => movie.sequence),
      'videos',
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
    version: z.literal(1),
    campaigns: z.array(Campaign),
  })
  .superRefine(({ campaigns }, ctx) => {
    const identities = new Set<string>();
    const maps = new Set<string>();
    for (const campaign of campaigns) {
      const key = `${campaign.id}/${campaign.language}`;
      if (identities.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate campaign locale' });
      identities.add(key);
      for (const map of campaign.maps) {
        if (maps.has(map.id)) ctx.addIssue({ code: 'custom', message: 'Map belongs to multiple campaigns' });
        maps.add(map.id);
      }
    }
  });
