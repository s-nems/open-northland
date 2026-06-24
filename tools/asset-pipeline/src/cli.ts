/**
 * Asset pipeline CLI — offline conversion of an OWNED original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes NO copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 *
 * Phase-1 stub: argument parsing + stage scaffolding are here. Each decoder is a TODO that should
 * be implemented by porting the FORMAT logic from the referenced OpenVikings C# file.
 */

interface Args {
  game: string;
  mod: string | undefined;
  out: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('--game');
  if (game === undefined) {
    throw new Error('usage: pipeline --game <dir> [--mod <subdir>] [--out <dir>]');
  }
  return { game, mod: get('--mod'), out: get('--out') ?? 'content' };
}

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stage order. Prefer the mod's readable .ini sources over base .cif (see docs/SOURCES.md).
  // 1. Unpack .lib archives                  -> ref OpenVikings NXBasics/CSimpleFileLibrary.cs
  // 2. Decode palettes + .hlt remap tables   -> ref NXBasics/CPalette.cs, CRemapTable.cs
  // 3. Decode .pcx pictures -> PNG           -> ref NXBasics/CPicture.cs, XBPictureTool.cs
  // 4. Decode .bmd bobs -> atlas + anim JSON -> ref NXBasics/CBobManager.cs, CBitmap.cs  (hardest)
  // 5. Parse .ini rules -> typed IR          -> trivial text parse, validate with @vinland/data
  // 6. Decode one map -> map IR
  // 7. Write content/ir.json manifest + validate the whole set with parseContentSet()

  console.log('[pipeline] not yet implemented — see docs/ROADMAP.md Phase 1 and src/decoders/.');
}

run(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
  console.error('[pipeline] failed:', err);
  process.exitCode = 1;
});
