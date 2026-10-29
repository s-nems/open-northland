// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminPanel } from '../../../../src/hud/dom/admin-panel/index.js';
import type {
  AdminPanelHandlers,
  AdminPanelSpec,
  AdminWorldState,
} from '../../../../src/hud/dom/admin-panel/model.js';
import { messages } from '../../../../src/i18n/index.js';

const copy = messages().admin;

afterEach(() => {
  document.body.replaceChildren();
});

const SPEC: AdminPanelSpec = {
  owners: [
    { player: 0, slot: 1, css: '#00f', name: 'Blue' },
    { player: 1, slot: 2, css: '#f00', name: 'Red' },
  ],
  owner: 0,
  hitpoints: 5000,
  weapons: [
    { value: 31, label: 'Bare hands' },
    { value: 34, label: 'Shortsword', goodId: 'sword_shord' },
  ],
  weapon: 34,
  armors: [
    { value: 0, label: 'None' },
    { value: 3, label: 'Chain Mail', goodId: 'armor_chain' },
  ],
  armor: 0,
  skills: 'basic',
  groups: [
    {
      id: 'people',
      title: 'People',
      tools: [
        { key: 'person:man', label: 'Man', knobs: ['owner', 'hitpoints', 'skills'] },
        { key: 'person:woman', label: 'Woman', knobs: ['owner', 'hitpoints'] },
      ],
    },
    {
      id: 'soldiers',
      title: 'Soldiers',
      tools: [{ key: 'soldier', label: 'Sword Soldier', knobs: ['owner', 'hitpoints', 'weapon', 'armor'] }],
    },
    {
      id: 'goods',
      title: 'Goods',
      note: 'One per click.',
      tools: [
        { key: 'good:1', label: 'Long Sword', knobs: [], goodId: 'sword_long' },
        { key: 'good:2', label: 'Bread', knobs: [], goodId: 'bread' },
      ],
    },
  ],
  actions: [
    { key: 'action:health', label: 'Set health', target: 'Click a building', percent: true },
    { key: 'teleport', label: 'Move settler', target: 'Click a settler' },
  ],
  healthPercent: 1,
  hasFog: true,
  speeds: [5, 10],
};

const WORLD: AdminWorldState = {
  needs: true,
  bioGround: false,
  fog: { map: 'off', fogOfWar: false },
  geometry: false,
  zoomOut: false,
  speed: 1,
};

function mount(overrides: Partial<AdminPanelHandlers> = {}) {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (value?: unknown): void => {
      calls.push(value === undefined ? name : `${name}:${String(value)}`);
    };
  const handlers: AdminPanelHandlers = {
    onOpen: log('open'),
    onAiView: log('ai'),
    onTool: log('tool'),
    onDisarm: log('disarm'),
    onOwner: log('owner'),
    onHitpoints: log('hp'),
    onWeapon: log('weapon'),
    onArmor: log('armor'),
    onSkills: log('skills'),
    onHealthPercent: log('percent'),
    onNeeds: log('needs'),
    onBioGround: log('bioGround'),
    onFogMap: log('fogMap'),
    onFogOfWar: log('fogOfWar'),
    onGeometry: log('geometry'),
    onZoomOut: log('zoomOut'),
    onSpeed: log('speed'),
    ...overrides,
  };
  const plane = document.createElement('div');
  document.body.append(plane);
  const painted: string[] = [];
  const panel = createAdminPanel(plane, { ...SPEC, paintGood: (_frame, id) => painted.push(id) }, handlers);
  plane.append(panel.toggle);
  const q = <T extends Element>(selector: string): T => {
    const found = plane.querySelector<T>(selector);
    if (found === null) throw new Error(`missing ${selector}`);
    return found;
  };
  const shownTiles = (): string[] =>
    [...plane.querySelectorAll<HTMLElement>('.on-admin__groups .on-admin__tile')]
      .filter((tile) => !tile.hidden && !(tile.closest('.on-admin__group') as HTMLElement).hidden)
      .map((tile) => tile.textContent ?? '');
  return { panel, plane, calls, painted, q, shownTiles };
}

describe('admin panel', () => {
  it('reports the AI tab shown only while the panel stands open on it', () => {
    const { panel, plane, calls } = mount();
    const tabs = [...plane.querySelectorAll<HTMLButtonElement>('.on-admin__tab')];
    const aiTab = tabs.find((tab) => tab.textContent === messages().admin.tabs.ai);
    panel.toggle.click();
    aiTab?.click();
    panel.toggle.click();
    panel.toggle.click();
    tabs[0]?.click();
    expect(calls).toEqual([
      'open:true',
      'ai:true',
      'open:false',
      'ai:false',
      'open:true',
      'ai:true',
      'ai:false',
    ]);
  });

  it('drops open from its toggle and closes on the toggle, the close medallion and Esc', () => {
    const { panel, q, calls } = mount();
    const section = q<HTMLElement>('.on-admin');
    expect(section.hidden).toBe(true);
    panel.toggle.click();
    expect(section.hidden).toBe(false);
    expect(panel.toggle.getAttribute('aria-expanded')).toBe('true');
    q<HTMLButtonElement>('.on-admin__close').click();
    expect(section.hidden).toBe(true);
    panel.toggle.click();
    q<HTMLElement>('.on-admin__tab').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(section.hidden).toBe(true);
    expect(calls).toEqual(['open:true', 'open:false', 'open:true', 'open:false']);
  });

  it('browses one group at a time, painting icons on its first showing, and searches across all', () => {
    const { q, shownTiles, painted, plane } = mount();
    expect(shownTiles()).toEqual(['Man', 'Woman']);
    // The equipment options are few, so they paint at once; the tiles wait for their group.
    expect(painted).toEqual(['sword_shord', 'armor_chain']);

    const goodsChip = plane.querySelectorAll<HTMLButtonElement>('.on-admin__chip')[2];
    goodsChip?.click();
    expect(shownTiles()).toEqual(['Long Sword', 'Bread']);
    expect(painted).toEqual(['sword_shord', 'armor_chain', 'sword_long', 'bread']);
    expect(q<HTMLElement>('.on-admin__note').textContent).toBe('One per click.');

    const search = q<HTMLInputElement>('.on-admin__search input');
    search.value = 'sword';
    search.dispatchEvent(new Event('input'));
    expect(shownTiles()).toEqual(['Sword Soldier', 'Long Sword']);
    expect(q<HTMLElement>('.on-admin__note').hidden).toBe(true);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(shownTiles()).toEqual([]);
    expect(q<HTMLElement>('.on-admin__empty').hidden).toBe(false);
  });

  it('names the chosen weapon and armor and passes every equipment pick through', () => {
    const { panel, plane, calls, q } = mount();
    plane.querySelectorAll<HTMLButtonElement>('.on-admin__chip')[1]?.click();
    panel.showArmed({ key: 'soldier', name: 'Sword Soldier · Blue', hint: 'Click the map' });
    const names = (): string[] =>
      [...plane.querySelectorAll('.on-admin__choice-name')].map((name) => name.textContent ?? '');
    expect(names()).toEqual(['Shortsword', 'None']);
    q<HTMLButtonElement>('.on-admin__choice[aria-label="Bare hands"]').click();
    q<HTMLButtonElement>('.on-admin__choice[aria-label="Chain Mail"]').click();
    expect(names()).toEqual(['Bare hands', 'Chain Mail']);
    plane.querySelectorAll<HTMLButtonElement>('.on-admin__chip')[0]?.click();
    const all = [
      ...plane.querySelectorAll<HTMLButtonElement>('.on-admin__options .on-segmented button'),
    ].find((b) => b.textContent === copy.skillModes.all);
    all?.click();
    expect(calls).toEqual(['tool:soldier', 'weapon:31', 'armor:3', 'skills:all']);
  });

  it('arms the only tool of a group when the group opens or one of its own settings changes', () => {
    const { panel, plane, calls, q } = mount();
    const chips = plane.querySelectorAll<HTMLButtonElement>('.on-admin__chip');
    chips[2]?.click(); // two goods: nothing to arm
    chips[1]?.click();
    expect(calls).toEqual(['tool:soldier']);
    panel.showArmed({ key: 'soldier', name: 'Sword Soldier · Blue', hint: 'Click the map' });
    q<HTMLButtonElement>('.on-admin__choice[aria-label="Bare hands"]').click();
    expect(calls).toEqual(['tool:soldier', 'weapon:31']); // already armed: a pick never disarms

    panel.showArmed(null);
    q<HTMLButtonElement>('.on-admin__choice[aria-label="Chain Mail"]').click();
    expect(calls).toEqual(['tool:soldier', 'weapon:31', 'armor:3', 'tool:soldier']);
  });

  it('reports a pressed tile and shows the armed tool lit in the tiles, the footer and the toggle', () => {
    const { panel, plane, calls, q } = mount();
    plane.querySelector<HTMLButtonElement>('.on-admin__tile')?.click();
    expect(calls).toEqual(['tool:person:man']);

    expect(q<HTMLElement>('.on-admin__status-text b').textContent).toBe(copy.idle);
    expect(q<HTMLElement>('.on-admin__disarm').hidden).toBe(true);
    panel.showArmed({ key: 'action:health', name: 'Set health', hint: 'Click a building' });
    expect(q<HTMLElement>('.on-admin__tile--action').getAttribute('aria-pressed')).toBe('true');
    expect(q<HTMLElement>('.on-admin__status-text b').textContent).toBe('Set health');
    expect(panel.toggle.dataset.armed).toBe('true');
    q<HTMLButtonElement>('.on-admin__disarm').click();
    expect(calls.at(-1)).toBe('disarm');
  });

  it('passes the owner, the health and the share field through', () => {
    const { plane, calls, q } = mount();
    plane.querySelectorAll<HTMLButtonElement>('.on-admin__swatch')[1]?.click();
    expect(q<HTMLElement>('.on-admin__owner-name').textContent).toBe('Red');
    const hp = q<HTMLInputElement>('.on-admin__knob input');
    hp.value = '120';
    hp.dispatchEvent(new Event('input'));
    const percent = q<HTMLInputElement>('.on-admin__number--percent input');
    percent.value = '250';
    percent.dispatchEvent(new Event('input'));
    expect(percent.value).toBe('100');
    expect(calls).toEqual(['owner:1', 'hp:120', 'percent:100']);
  });

  it('shows the world state and leaves fog of war off a revealed map', () => {
    const { panel, plane, calls } = mount();
    panel.showWorld(WORLD);
    const switches = [...plane.querySelectorAll<HTMLButtonElement>('.on-switch')];
    const [needs, bioGround, fogOfWar] = switches;
    expect(needs?.getAttribute('aria-checked')).toBe('true');
    expect(bioGround?.getAttribute('aria-checked')).toBe('false');
    expect(fogOfWar?.getAttribute('aria-disabled')).toBe('true');
    fogOfWar?.click();
    needs?.click();
    bioGround?.click();
    expect(calls).toEqual(['needs:false', 'bioGround:true']);

    panel.showWorld({ ...WORLD, fog: { map: 'classic', fogOfWar: false } });
    expect(fogOfWar?.hasAttribute('aria-disabled')).toBe(false);
    const speeds = [
      ...plane.querySelectorAll<HTMLButtonElement>('.on-admin__pane .on-segmented button'),
    ].filter((b) => b.textContent === '×10');
    speeds[0]?.click();
    expect(calls.at(-1)).toBe('speed:10');
  });
});
