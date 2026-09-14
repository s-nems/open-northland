import { describe, expect, it } from 'vitest';
import { type PaperNaming, paperLabel } from '../src/hud/tool-panel/paper-label.js';
import { messages } from '../src/i18n/index.js';

/** A paper's display name: the decoded `misclogic` row with its subject filled in, else the catalog's. */

const naming: PaperNaming = {
  uiString: (_table, id, fallback) => (id === 182 ? "Umieść '%s'" : fallback),
  buildingLabel: (typeId) => (typeId === 41 ? 'Wieża' : undefined),
  jobLabel: () => 'Kowal',
  goodLabel: () => undefined,
};

describe('paperLabel', () => {
  it('fills the decoded row with the named house', () => {
    expect(paperLabel({ kind: 'placeHouse', param: 41 }, naming)).toBe("Umieść 'Wieża'");
  });

  it('falls back to the catalog row, naming an unknown subject by id', () => {
    const rows = messages().hud.extras.papers;
    expect(paperLabel({ kind: 'placeAny', param: 0 }, naming)).toBe(rows.placeAny);
    expect(paperLabel({ kind: 'learnPermit', param: 13 }, naming)).toBe(
      rows.learnPermit.replace('{name}', 'Kowal'),
    );
    expect(paperLabel({ kind: 'producePermit', param: 8 }, naming)).toBe(
      rows.producePermit.replace('{name}', '#8'),
    );
  });
});
