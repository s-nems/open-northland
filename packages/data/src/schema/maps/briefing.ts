import { z } from 'zod';

/** One rendered run of a briefing page: headline or body text, inner line breaks kept. */
export const BriefingParagraph = z.strictObject({
  style: z.enum(['title', 'body']),
  text: z.string(),
});
export type BriefingParagraph = z.infer<typeof BriefingParagraph>;

/**
 * A map's `maps/<id>.briefing.json` sidecar: the mission-window pages its `PlayCutscene <id>` results
 * name, rendered from `text/<lang>/briefings/`, keyed by language (`pol`, `eng`) then by cutscene id.
 */
export const MapBriefing = z.strictObject({
  texts: z.record(z.string(), z.record(z.string(), z.array(BriefingParagraph))),
});
export type MapBriefing = z.infer<typeof MapBriefing>;
