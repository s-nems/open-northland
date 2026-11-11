import { formatMessage, messages } from '../../../i18n/index.js';
import { UNLIMITED_GAME_SPEED } from '../../tool-panel/game-speed.js';
import { element, setHidden, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSegmented, type SegmentedOption } from '../parts/segmented.js';
import { createSwitch } from '../parts/switch.js';
import type { AdminPanelHandlers, AdminPanelSpec, AdminWorldState, FogMapKey } from './model.js';

const FOG_MAPS: readonly FogMapKey[] = ['off', 'classic', 'recon'];
/** The unlimited tempo's segment, named in full by its tooltip. */
const UNLIMITED_LABEL = '∞';

export interface WorldTab {
  readonly element: HTMLElement;
  show(state: AdminWorldState): void;
}

/** One setting: its name and what it does on the left, its control on the right. */
function settingRow(name: string, hint: string, control: HTMLElement): HTMLElement {
  const row = element('div', 'on-admin__row');
  const text = element('div', 'on-admin__row-text');
  const title = element('b', '');
  write(title, name);
  text.append(title);
  if (hint !== '') {
    const small = element('small', '');
    write(small, hint);
    text.append(small);
  }
  row.append(text, control);
  return row;
}

function sectionTitled(title: string): HTMLElement {
  const section = createSection();
  section.update(title);
  return section.element;
}

/** The world tab: the session's rules, visibility, debug tempo and view aids, each read back live. */
export function createWorldTab(
  spec: AdminPanelSpec,
  handlers: Pick<
    AdminPanelHandlers,
    'onNeeds' | 'onBioGround' | 'onFogMap' | 'onFogOfWar' | 'onGeometry' | 'onZoomOut' | 'onSpeed'
  >,
): WorldTab {
  const copy = messages().admin;
  const root = element('div', 'on-admin__pane');

  let state: AdminWorldState | null = null;
  const needs = createSwitch(copy.needs, '', (next) => handlers.onNeeds(next));
  const bioGround = createSwitch(copy.bioGround, '', (next) => handlers.onBioGround(next));
  root.append(
    sectionTitled(copy.sections.rules),
    settingRow(copy.needs, copy.needsHint, needs.element),
    settingRow(copy.bioGround, copy.bioGroundHint, bioGround.element),
  );

  const fogOptions: Readonly<Record<FogMapKey, SegmentedOption>> = {
    off: { label: copy.fogModes.off },
    classic: { label: copy.fogModes.classic },
    recon: { label: copy.fogModes.recon },
  };
  const fogMap = createSegmented(FOG_MAPS, copy.fogMap, (key) => handlers.onFogMap(key));
  fogMap.element.classList.add('on-admin__segmented');
  const fogOfWar = createSwitch(copy.fogOfWar, '', (next) => handlers.onFogOfWar(next));
  const fogSection = element('div', '');
  fogSection.append(
    sectionTitled(copy.sections.visibility),
    settingRow(copy.fogMap, '', fogMap.element),
    settingRow(copy.fogOfWar, copy.fogOfWarHint, fogOfWar.element),
  );
  setHidden(fogSection, !spec.hasFog);
  root.append(fogSection);

  const speedKeys = spec.speeds.map(String);
  const speedOptions = Object.fromEntries(
    spec.speeds.map((factor): [string, SegmentedOption] => [
      String(factor),
      factor === UNLIMITED_GAME_SPEED
        ? { label: UNLIMITED_LABEL, tooltip: copy.speedUnlimited }
        : { label: formatMessage(copy.speedFactor, { factor }) },
    ]),
  );
  const speed = createSegmented(speedKeys, copy.speed, (key) => handlers.onSpeed(Number(key)));
  speed.element.classList.add('on-admin__segmented');
  const speedSection = element('div', '');
  speedSection.append(
    sectionTitled(copy.sections.time),
    settingRow(copy.speed, copy.speedHint, speed.element),
  );
  setHidden(speedSection, speedKeys.length === 0);
  root.append(speedSection);

  const geometry = createSwitch(copy.geometry, '', (next) => handlers.onGeometry(next));
  const zoomOut = createSwitch(copy.zoomOut, '', (next) => handlers.onZoomOut(next));
  root.append(
    sectionTitled(copy.sections.view),
    settingRow(copy.geometry, copy.geometryHint, geometry.element),
    settingRow(copy.zoomOut, copy.zoomOutHint, zoomOut.element),
  );

  return {
    element: root,
    show(next): void {
      if (state !== null && sameWorld(state, next)) return;
      state = next;
      needs.update(next.needs, true);
      bioGround.update(next.bioGround, true);
      fogMap.update(fogOptions, next.fog?.map ?? null);
      // A revealed map shows everything, so its fog of war has nothing to hide.
      fogOfWar.update(next.fog?.fogOfWar === true, next.fog !== null && next.fog.map !== 'off');
      speed.update(speedOptions, next.speed === null ? null : String(next.speed));
      geometry.update(next.geometry, true);
      zoomOut.update(next.zoomOut, true);
    },
  };
}

function sameWorld(a: AdminWorldState, b: AdminWorldState): boolean {
  return (
    a.needs === b.needs &&
    a.bioGround === b.bioGround &&
    a.fog?.map === b.fog?.map &&
    a.fog?.fogOfWar === b.fog?.fogOfWar &&
    a.geometry === b.geometry &&
    a.zoomOut === b.zoomOut &&
    a.speed === b.speed
  );
}
