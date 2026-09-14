import type { Paper, PaperKind } from '@open-northland/sim';
import type { UiString } from '../../content/gui-gfx.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The ingamegui table the paper names live in. */
const PAPER_STRINGS_TABLE = 'misclogic';

/** The `misclogic` row naming each paper kind; the rows with a subject carry a `%s` for it. */
const PAPER_STRING_ID: Readonly<Record<PaperKind, number>> = {
  indulgence: 180,
  placeAny: 181,
  placeHouse: 182,
  placeStockedHouse: 183,
  buildPermit: 184,
  learnPermit: 185,
  producePermit: 186,
};

/** The decoded rows' subject placeholder; the catalog stand-ins carry `{name}` instead. */
const SUBJECT_PLACEHOLDER = '%s';

export interface PaperNaming {
  readonly uiString: UiString;
  readonly buildingLabel: (typeId: number) => string | undefined;
  readonly jobLabel: (typeId: number) => string | undefined;
  readonly goodLabel: (typeId: number) => string | undefined;
}

/** What a paper's `param` names, per kind; the two subject-less kinds name nothing. */
function subjectOf(paper: Paper, naming: PaperNaming): string | null {
  switch (paper.kind) {
    case 'indulgence':
    case 'placeAny':
      return null;
    case 'placeHouse':
    case 'placeStockedHouse':
    case 'buildPermit':
      return naming.buildingLabel(paper.param) ?? `#${paper.param}`;
    case 'learnPermit':
      return naming.jobLabel(paper.param) ?? `#${paper.param}`;
    case 'producePermit':
      return naming.goodLabel(paper.param) ?? `#${paper.param}`;
  }
}

/** A paper's display name, as the papers list and the found-paper note show it. */
export function paperLabel(paper: Paper, naming: PaperNaming): string {
  const name = subjectOf(paper, naming) ?? '';
  const fallback = formatMessage(messages().hud.extras.papers[paper.kind], { name });
  return naming
    .uiString(PAPER_STRINGS_TABLE, PAPER_STRING_ID[paper.kind], fallback)
    .replace(SUBJECT_PLACEHOLDER, name);
}
