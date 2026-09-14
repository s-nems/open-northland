/** The `utilityProcess` argv the pipeline child is forked with. */
export function encodePipelineArgv(outDir: string, modRoot: string): string[] {
  return [outDir, modRoot];
}

export interface PipelineChildArgs {
  readonly outDir: string;
  readonly modRoot: string;
}

/** Undefined for an argv no host encoded: a missing out dir or mod root. */
export function decodePipelineArgv(argv: readonly string[]): PipelineChildArgs | undefined {
  const [outDir, modRoot] = argv;
  if (outDir === undefined || outDir === '' || modRoot === undefined || modRoot === '') return undefined;
  return { outDir, modRoot };
}
