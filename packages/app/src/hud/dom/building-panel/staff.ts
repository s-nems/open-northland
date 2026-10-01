import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  BuildingPanelModel,
  BuildingStaffModel,
  PersonLook,
  StaffGroup,
  StaffPerson,
} from '../../details-panel/model/index.js';
import { FIGURE } from '../icons.js';
import { element, setAttribute, setClass, setDisabled, setHidden, setTip, write } from '../parts/dom.js';
import { createFigureWell, type FigureWell, showInWell } from '../parts/figure-well.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';

/** The wells a group shows before the rest reads as "+N": two rows beside a label. */
export const STAFF_WELLS_MAX = 12;

/** One well of a group: a person, a seat nobody holds, a family place free, or the rest counted. */
export type StaffWell =
  | { readonly kind: 'person'; readonly person: StaffPerson }
  | { readonly kind: 'seat' }
  | { readonly kind: 'more'; readonly count: number };

/** A group's wells: its people, then its free seats, at most {@link STAFF_WELLS_MAX}. Free seats give
 *  way first; people past the cap are counted in the last well. */
export function staffWells(group: StaffGroup): StaffWell[] {
  const people = group.people.map((person): StaffWell => ({ kind: 'person', person }));
  if (people.length > STAFF_WELLS_MAX) {
    const kept = people.slice(0, STAFF_WELLS_MAX - 1);
    return [...kept, { kind: 'more', count: people.length - kept.length }];
  }
  const free = group.capacity === null ? 0 : Math.max(0, group.capacity - people.length);
  const seats = Math.min(free, STAFF_WELLS_MAX - people.length);
  return [...people, ...Array.from({ length: seats }, (): StaffWell => ({ kind: 'seat' }))];
}

const LOOK_CLASS: Readonly<Record<PersonLook, string>> = {
  man: '',
  woman: 'on-seat-well--woman',
  soldier: 'on-seat-well--soldier',
  child: 'on-seat-well--child',
};

/** Workers, Residents or Builders: a line per group (a trade's seats, the sheltering crowd, a
 *  family) with a well per person showing it live, and the filled and declared seats on the rule. A
 *  press on a person selects it; a press on a trade's free seat lists who could take it. */
export interface StaffSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
  /** Every well shown, for the panel's figure painter. */
  wells(): readonly FigureWell[];
}

/** `staffOf` picks the section's groups from the model: its staff or a site's crew. */
export function createStaffSection(
  deps: BuildingPanelDeps,
  staffOf: (model: BuildingPanelModel) => BuildingStaffModel | null,
): StaffSection {
  const count = element('span', 'on-section__count');
  const title = createSection(count);
  const list = element('div', 'on-staff');
  const root = element('div', '');
  root.append(title.element, list);
  let shape = '';
  let lines: { label: HTMLElement; wells: HTMLElement }[] = [];
  let wellNodes: FigureWell[][] = [];
  let allWells: FigureWell[] = [];
  let shownWells: StaffWell[][] = [];
  let shownGroups: StaffGroup[] = [];

  const paintWell = (well: FigureWell, shown: StaffWell, group: StaffGroup): void => {
    const copy = messages().hud.buildingPanel;
    const { node } = well;
    const person = shown.kind === 'person' ? shown.person : null;
    showInWell(well, person?.entity ?? null);
    const face =
      person === null
        ? shown.kind === 'more'
          ? `+${shown.count}`
          : ''
        : person.look === 'woman'
          ? FIGURE.woman
          : FIGURE.man;
    if (node.dataset.face !== face) {
      node.dataset.face = face;
      well.glyph.innerHTML = face;
    }
    for (const look of Object.keys(LOOK_CLASS) as PersonLook[]) {
      const name = LOOK_CLASS[look];
      if (name !== '') setClass(node, name, person?.look === look);
    }
    setClass(node, 'on-seat-well--empty', person === null);
    setClass(node, 'on-seat-well--more', shown.kind === 'more');
    const tip =
      person !== null
        ? formatMessage(copy.person, { name: person.name, job: person.job })
        : shown.kind === 'more'
          ? formatMessage(copy.morePeople, { count: shown.count })
          : group.jobType !== null
            ? formatMessage(copy.emptySeat, { job: group.label })
            : group.label === ''
              ? copy.freeFamily
              : formatMessage(copy.freeSeat, { group: group.label });
    setTip(node, tip);
    setAttribute(node, 'aria-label', person?.name ?? tip);
    setDisabled(node, person === null && (shown.kind !== 'seat' || group.jobType === null));
  };

  return {
    element: root,
    wells: () => allWells,
    update(model): void {
      const staff = staffOf(model);
      setHidden(root, staff === null);
      if (staff === null) {
        for (const well of allWells) showInWell(well, null);
        return;
      }
      const copy = messages().hud.buildingPanel;
      title.update(
        staff.kind === 'residents' ? copy.residents : staff.kind === 'crew' ? copy.crew : copy.workers,
      );
      setHidden(count, staff.count === null);
      if (staff.count !== null) {
        write(count, `${staff.count.filled} / ${staff.count.capacity}`);
        setTip(count, staff.kind === 'residents' ? copy.familyCount : copy.seatCount);
      }
      // A home's free family places read as one line of empty wells after the families.
      const free =
        staff.kind === 'residents' && staff.count !== null
          ? Math.max(0, staff.count.capacity - staff.count.filled)
          : 0;
      const groups: StaffGroup[] =
        free > 0
          ? [...staff.groups, { key: 'free', label: '', people: [], capacity: free, jobType: null }]
          : [...staff.groups];
      shownGroups = groups;
      setClass(list, 'on-staff--families', staff.kind === 'residents');
      shownWells = groups.map(staffWells);
      const nextShape = groups.map((group, index) => `${group.key}:${shownWells[index]?.length}`).join('|');
      if (nextShape !== shape) {
        shape = nextShape;
        lines = [];
        wellNodes = [];
        const nodes = groups.map((_, groupIndex) => {
          const line = element('div', 'on-staff__line');
          const label = element('span', 'on-staff__label');
          const wells = element('span', 'on-staff__wells');
          const buttons = (shownWells[groupIndex] ?? []).map((_, wellIndex) => {
            const well = createFigureWell('on-seat-well on-seat-well--person');
            well.node.addEventListener('click', () => {
              const shown = shownWells[groupIndex]?.[wellIndex];
              const jobType = shownGroups[groupIndex]?.jobType ?? null;
              if (shown?.kind === 'person') deps.actions.select(shown.person.entity);
              else if (shown?.kind === 'seat' && jobType !== null) deps.windows.residentsFor(jobType);
            });
            return well;
          });
          wells.append(...buttons.map((well) => well.node));
          line.append(label, wells);
          lines.push({ label, wells });
          wellNodes.push(buttons);
          return line;
        });
        list.replaceChildren(...nodes);
        allWells = wellNodes.flat();
      }
      groups.forEach((group, groupIndex) => {
        const line = lines[groupIndex];
        if (line === undefined) return;
        const wells = shownWells[groupIndex] ?? [];
        const text = wells.length === 0 ? copy.nobody : group.label;
        setHidden(line.label, text === '');
        write(line.label, text);
        setClass(line.label, 'on-ledger--muted', wells.length === 0);
        wells.forEach((shown, wellIndex) => {
          const well = wellNodes[groupIndex]?.[wellIndex];
          if (well !== undefined) paintWell(well, shown, group);
        });
      });
    },
  };
}
