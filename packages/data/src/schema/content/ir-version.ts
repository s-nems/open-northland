/** Current IR schema version and the only stamp {@link IrManifest} accepts. Bump on any schema change,
 *  a new lane included: generated content is regenerated, never read with a lane defaulted. */
export const IR_VERSION = 9 as const;

/** The manifest stamp of content that never went through the pipeline: synthetic sandbox and test
 *  sets, and the absent-field default. A pipeline conversion always writes its real revision. */
export const NO_PIPELINE_REVISION = 0;
