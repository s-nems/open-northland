import { z } from 'zod';
import { HypertextBlock } from '../gui/hypertext.js';

/**
 * A map's `maps/<id>.briefing.json` sidecar: the mission-window pages its `PlayCutscene <id>` results
 * name, rendered from `text/<lang>/briefings/`, keyed by language (`pol`, `eng`) then by cutscene id.
 */
export const MapBriefing = z.strictObject({
  texts: z.record(z.string(), z.record(z.string(), z.array(HypertextBlock))),
});
export type MapBriefing = z.infer<typeof MapBriefing>;
