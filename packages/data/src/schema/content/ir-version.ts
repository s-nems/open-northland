/** Current IR schema version and the only stamp {@link IrManifest} accepts. Bump on a breaking shape
 *  change, or on an addition that generated content must carry for real rather than by default. */
export const IR_VERSION = 6 as const;

/** The manifest stamp of content that never went through the pipeline: synthetic sandbox and test
 *  sets, and the absent-field default. A pipeline conversion always writes its real revision. */
export const NO_PIPELINE_REVISION = 0;
