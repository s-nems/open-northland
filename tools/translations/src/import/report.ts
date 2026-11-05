import { OVERLAY_LANGUAGES } from '@open-northland/data';
import type { MatchedMap } from './maps.js';
import { type Alignment, GLOSSARY_FILE, type ImportResult, PROJECT_GLOSSARY_FILE } from './run.js';

const PERCENT = 100;
const PERCENT_DIGITS = 1;

function rate({ equal, total }: Alignment): string {
  const share = total === 0 ? 0 : (equal / total) * PERCENT;
  return `${equal}/${total} (${share.toFixed(PERCENT_DIGITS)}%)`;
}

function isCampaign(map: MatchedMap): boolean {
  return map.map.campaign !== undefined;
}

/** The import's plain-text report: what matched, what was written, and how far the keys line up. */
export function formatReport(result: ImportResult, sourceCommit: string): string {
  const { maps } = result;
  const lines: string[] = [];
  const add = (line = ''): void => {
    lines.push(line);
  };
  add(`CulturesGameLocalization ${sourceCommit}`);
  add();
  const campaign = maps.matched.filter(isCampaign).length;
  add(
    `Map XMLs: ${maps.xmlCount}; matched ${maps.matched.length} pack maps (${campaign} campaign, ${maps.matched.length - campaign} base)`,
  );
  for (const map of maps.matched) {
    const extra = [
      ...(map.aliases.length > 0 ? [`also serves ${map.aliases.join(', ')}`] : []),
      ...(map.twins.length > 0 ? [`same map.dat, other German text: ${map.twins.join(', ')}`] : []),
      ...(map.passedOver.length > 0 ? [`passed over ${map.passedOver.join(', ')}`] : []),
    ];
    add(`  ${map.map.id} <- ${map.xml}${extra.length > 0 ? ` (${extra.join('; ')})` : ''}`);
  }
  add(`Unmatched XMLs (${maps.unmatched.length}): ${maps.unmatched.join(', ')}`);
  if (maps.deprecated.length > 0) add(`Deprecated XMLs skipped: ${maps.deprecated.join(', ')}`);
  if (maps.withoutBasis.length > 0)
    add(`Matched without German text, skipped: ${maps.withoutBasis.join(', ')}`);
  add();

  add('German round trip (XML ger column against our pack):');
  for (const [group, members] of [
    ['campaign maps', maps.matched.filter(isCampaign)],
    ['base maps', maps.matched.filter((map) => !isCampaign(map))],
  ] as const) {
    const sum = (count: (map: MatchedMap) => number): number => members.reduce((s, map) => s + count(map), 0);
    const blockTotal = sum((map) => map.roundTrip.blocks.total);
    add(`  ${group}:`);
    add(
      `    strings equal: ${rate({ total: sum((map) => map.roundTrip.strings.total), equal: sum((map) => map.roundTrip.strings.equal) })}`,
    );
    add(
      `    block bodies equal after whitespace normalisation: ${rate({ total: blockTotal, equal: sum((map) => map.roundTrip.blocks.normalized) })}`,
    );
    add(
      `    block bodies equal exactly: ${rate({ total: blockTotal, equal: sum((map) => map.roundTrip.blocks.exact) })}`,
    );
  }
  for (const map of maps.matched) {
    const { strings: s, blocks: b } = map.roundTrip;
    const parts = [
      ...(s.mismatches.length > 0 ? [`strings ${s.mismatches.join(', ')}`] : []),
      ...(b.mismatches.length > 0 ? [`blocks ${b.mismatches.join(', ')}`] : []),
      ...(s.untranslated.length > 0 ? [`strings the XML lacks ${s.untranslated.join(', ')}`] : []),
    ];
    if (parts.length > 0) add(`  ${map.map.id} differs: ${parts.join('; ')}`);
  }
  add();

  for (const lang of OVERLAY_LANGUAGES) {
    let files = 0;
    let stringCount = 0;
    let blockCount = 0;
    const unknown: string[] = [];
    const markup: string[] = [];
    const retagged: string[] = [];
    const unframed: string[] = [];
    const corrected: string[] = [];
    for (const map of maps.matched) {
      const result = map.languages[lang];
      if (result === undefined) continue;
      if (result.strings + result.blocks > 0) files++;
      stringCount += result.strings;
      blockCount += result.blocks;
      unknown.push(...result.unknown.map((key) => `${map.map.id} ${key}`));
      markup.push(...result.markupMismatches.map((key) => `${map.map.id} ${key}`));
      retagged.push(...result.retagged.map((key) => `${map.map.id} ${key}`));
      unframed.push(...result.unframed.map((key) => `${map.map.id} ${key}`));
      if (result.corrected.length > 0) corrected.push(`${map.map.id} ${result.corrected.join(', ')}`);
    }
    add(`${lang}: ${files} map overlays, ${stringCount} strings, ${blockCount} briefing blocks`);
    if (unknown.length > 0)
      add(`  left out, our German lacks the key (${unknown.length}): ${unknown.join('; ')}`);
    if (markup.length > 0)
      add(
        `  left out, goal prefix, placeholders or tag names differ (${markup.length}): ${markup.join('; ')}`,
      );
    if (retagged.length > 0)
      add(`  tag arguments differed, taken from our German (${retagged.length}): ${retagged.join('; ')}`);
    if (unframed.length > 0)
      add(`  shaped unlike the German column, run edges kept (${unframed.length}): ${unframed.join('; ')}`);
    if (corrected.length > 0)
      add(
        `  our German of these keys is corrected, the translation follows the original: ${corrected.join('; ')}`,
      );
  }
  add();

  add('Object tables (translated entries; ids whose German name differs from ours are left out):');
  for (const table of result.tables) {
    const parts = OVERLAY_LANGUAGES.map((lang) => {
      const counts = table.languages[lang];
      return counts === undefined
        ? `${lang} none`
        : `${lang} ${counts.names} names, ${counts.plurals} plurals${counts.unknown > 0 ? `, ${counts.unknown} unknown ids left out` : ''}`;
    });
    const drifted = table.drifted.length > 0 ? `; German differs for ids ${table.drifted.join(', ')}` : '';
    const corrected =
      table.corrected.length > 0 ? `; our German corrected for ids ${table.corrected.join(', ')}` : '';
    add(`  ${table.table}: ${parts.join('; ')}${drifted}${corrected}`);
  }
  if (result.book !== undefined) {
    const { book } = result;
    add(`History book: German blocks equal ${rate(book.alignment)}`);
    for (const lang of OVERLAY_LANGUAGES) {
      const counts = book.languages[lang];
      if (counts === undefined) continue;
      add(
        `  ${lang}: ${counts.blocks} blocks${counts.unknown.length > 0 ? `; left out, our German lacks: ${counts.unknown.join(', ')}` : ''}`,
      );
    }
  }
  for (const lang of OVERLAY_LANGUAGES) {
    const counts = result.personalNames.languages[lang];
    if (counts === undefined) continue;
    add(`Personal names ${lang}: ${counts.names} of the pool names translated`);
  }
  add(
    `Glossary: rewrote ${GLOSSARY_FILE} with the ${result.glossaryTerms} upstream terms; the project's ` +
      `terms are in ${PROJECT_GLOSSARY_FILE}, which the import leaves alone`,
  );
  add(`Files written: ${result.files.length} overlays and ${GLOSSARY_FILE}`);
  return lines.join('\n');
}
