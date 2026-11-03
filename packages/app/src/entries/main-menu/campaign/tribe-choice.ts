import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { RECOMMENDED_CAMPAIGN_TRIBE } from '../../../campaign/launch.js';
import { type CivilizationRow, loadCivilizations } from '../../../content/civilizations.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { tribeEmblem } from '../lobby-controls/tribe-emblems.js';

/** Keys that move the choice to the previous or next civilization, as in any radio group. */
const STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

/** The civilizations a build offers without content: the authored five, until the IR names more. */
const DEFAULT_TRIBES: readonly CivilizationRow[] = CIVILIZATION_TRIBES.map((typeId) => ({ typeId }));

/**
 * The campaign's civilization as a secondary setting: one emblem per civilization in a radio group,
 * the recommended one starred, and the chosen one's name beside them.
 */
export function campaignTribeChoice(initial: number, change: (tribe: number) => void) {
  const copy = messages().campaign;
  const root = node('div', 'campaign-tribe');
  const label = node('span', 'campaign-tribe__label', copy.nation);
  label.id = 'campaign-tribe-label';
  const group = node('div', 'campaign-tribe__options');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', label.id);
  group.title = copy.tribeTitle;
  const name = node('span', 'campaign-tribe__name');
  const note = node('span', 'campaign-tribe__note');
  const chosen = node('span', 'campaign-tribe__chosen');
  chosen.setAttribute('aria-hidden', 'true');
  chosen.append(name, note);
  root.append(label, group, chosen);

  let current = initial;
  const pick = (tribe: number): void => {
    if (tribe === current) return;
    current = tribe;
    render();
    change(tribe);
  };
  const render = (): void => {
    for (const { tribe, option } of options) {
      const checked = tribe === current;
      option.setAttribute('aria-checked', String(checked));
      option.tabIndex = checked ? 0 : -1;
    }
    name.textContent = tribeName(current);
    note.textContent =
      current === RECOMMENDED_CAMPAIGN_TRIBE
        ? copy.tribeNote
        : formatMessage(copy.tribeChoice, { tribe: tribeName(RECOMMENDED_CAMPAIGN_TRIBE) });
    note.classList.toggle('is-recommended', current === RECOMMENDED_CAMPAIGN_TRIBE);
  };

  let options: { tribe: number; option: HTMLElement }[] = [];
  const renderOptions = (rows: readonly CivilizationRow[]): void => {
    group.replaceChildren();
    options = rows.map(({ typeId: tribe }) => {
      const option = node('button', 'campaign-tribe__option');
      option.type = 'button';
      option.setAttribute('role', 'radio');
      const recommended = tribe === RECOMMENDED_CAMPAIGN_TRIBE;
      option.classList.toggle('is-recommended', recommended);
      option.title = recommended ? `${tribeName(tribe)} (${copy.tribeNote})` : tribeName(tribe);
      option.setAttribute('aria-label', option.title);
      option.append(tribeEmblem(tribe, 'campaign-tribe__emblem'));
      option.addEventListener('click', () => pick(tribe));
      group.append(option);
      return { tribe, option };
    });
    render();
  };
  renderOptions(DEFAULT_TRIBES);
  // A content pack's own people joins the choice once the served IR has answered.
  void loadCivilizations().then((rows) => {
    if (rows.length > DEFAULT_TRIBES.length) renderOptions(rows);
  });

  group.addEventListener('keydown', (event) => {
    const at = options.findIndex(({ tribe }) => tribe === current);
    const step = STEP_KEYS[event.key];
    const target =
      event.key === 'Home'
        ? options[0]
        : event.key === 'End'
          ? options.at(-1)
          : step === undefined
            ? undefined
            : options[(at + step + options.length) % options.length];
    if (target === undefined) return;
    event.preventDefault();
    pick(target.tribe);
    target.option.focus();
  });
  render();
  return { root };
}
