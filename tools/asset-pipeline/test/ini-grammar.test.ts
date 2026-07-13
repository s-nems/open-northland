import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import { cifLinesToSections, decodeIni, parseIniSections } from '../src/decoders/ini.js';

describe('decodeIni (CP1250 byte->text seam)', () => {
  it('decodes 0x80..0xFF bytes as CP1250 Polish glyphs, not UTF-8', () => {
    // "Północ" (mod campaign theme) from its exact CP1250 bytes: 'ó' is 0xF3, 'ł' is 0xB3.
    const polnoc = Uint8Array.from([0x50, 0xf3, 0xb3, 0x6e, 0x6f, 0x63]); // P ó ł n o c
    expect(decodeIni(polnoc)).toBe('Północ');
    // The same bytes read as UTF-8 mangle the high bytes into replacement chars — the bug we avoid.
    expect(new TextDecoder('utf-8').decode(polnoc)).not.toBe('Północ');
  });

  it('leaves ASCII structure (header, [section], keys) byte-identical', () => {
    const text = '<CULTURES_CIF_BEGIN>\n[goodtype]\nname "wood"\ntype 5\n';
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(decodeIni(bytes)).toBe(text);
  });

  it('feeds the parser so a CP1250 display name reaches the section unmangled', () => {
    // 'ś' is 0x9C, 'ą' is 0xB9 in Windows-1250 — exactly the bytes a UTF-8 read would corrupt.
    const bytes = Uint8Array.from([
      0x5b,
      0x74,
      0x5d,
      0x0a, // "[t]\n"
      0x6e,
      0x61,
      0x6d,
      0x65,
      0x20,
      0x22, // 'name "'
      0x9c,
      0xb9, // 'ś', 'ą'
      0x22,
      0x0a, // '"\n'
    ]);
    const [sec] = parseIniSections(decodeIni(bytes));
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['śą']);
  });
});

// A focused two-record slice for the parser test (the extractor's LANDSCAPE_INI grew more records).
const PARSE_LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><000002BF> Don't modify this line!
[landscapetype]
type 4
name "tree"
allowedonland 1
maximumValency 5
transition 7 4 2 1 0
transition 11 5 2 0 0
debugcolor 2 115 0
[landscapetype]
type 5
name "tree falling"
allowedonland 1
maximumValency 5
`;

describe('parseIniSections', () => {
  it('parses sections, skips the CIF header/blank lines, keeps multi-value + repeated keys', () => {
    const sections = parseIniSections(PARSE_LANDSCAPE_INI);
    expect(sections.map((s) => s.name)).toEqual(['landscapetype', 'landscapetype']);

    const tree = sections[0];
    expect(tree?.name).toBe('landscapetype');
    // quoted value -> single token; signed/multi values preserved as raw strings.
    expect(tree?.props.find((p) => p.key === 'name')?.values).toEqual(['tree']);
    expect(tree?.props.find((p) => p.key === 'debugcolor')?.values).toEqual(['2', '115', '0']);
    // repeated `transition` keys are both retained in file order.
    expect(tree?.props.filter((p) => p.key === 'transition')).toHaveLength(2);
  });

  it('treats a quoted value with spaces as one token', () => {
    const [sec] = parseIniSections('[t]\nname "tree falling"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['tree falling']);
  });

  it('strips `//` inline and full-line comments (the marker real .ini files use)', () => {
    // landscapetypes.ini has lines like: `transition 3 80 2 -1 9 // transition 3 80 2 -1 9`
    const sections = parseIniSections('[t]\n// a full-line comment\ntransition 3 80 2 -1 9 // dup\n');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.props).toEqual([{ key: 'transition', values: ['3', '80', '2', '-1', '9'] }]);
  });

  it('keeps a `//` that lives inside a quoted value', () => {
    const [sec] = parseIniSections('[t]\nname "a // b"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['a // b']);
  });
});

describe('cifLinesToSections (unification with .cif)', () => {
  it('produces the same RuleSection shape from level-tagged lines as .ini does', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'landscapetype' },
      { level: 2, text: 'type 4' },
      { level: 2, text: 'name "tree"' },
      { level: 2, text: 'debugcolor 2 115 0' },
    ];
    const fromCif = cifLinesToSections(lines);
    const fromIni = parseIniSections('[landscapetype]\ntype 4\nname "tree"\ndebugcolor 2 115 0\n');
    expect(fromCif).toEqual(fromIni);
  });
});
