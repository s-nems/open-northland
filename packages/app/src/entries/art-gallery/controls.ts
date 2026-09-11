import type { GalleryEntry } from './catalog.js';
import type { GalleryState } from './state.js';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
export function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function galleryControls(
  selected: GalleryEntry,
  entries: readonly GalleryEntry[],
  state: GalleryState,
  changed: () => void,
): HTMLElement {
  const controls = element('div');
  controls.className = 'toolbar';
  function select(
    label: string,
    values: readonly (readonly [string, string])[],
    current: string,
    set: (value: string) => void,
  ): void {
    const wrapper = element('label', label);
    const input = element('select');
    input.setAttribute('aria-label', label);
    for (const [value, title] of values) {
      const option = element('option', title);
      option.value = value;
      input.append(option);
    }
    if (!values.some(([value]) => value === current)) {
      const option = element('option', current);
      option.value = current;
      input.append(option);
    }
    input.value = current;
    input.addEventListener('change', () => {
      set(input.value);
      changed();
    });
    wrapper.append(input);
    controls.append(wrapper);
  }
  select(
    'Zoom',
    [
      ['1', '×1'],
      ['2', '×2'],
    ],
    String(state.zoom),
    (value) => {
      state.zoom = value === '1' ? 1 : 2;
    },
  );
  select(
    'Background',
    [
      ['dark', 'Dark'],
      ['light', 'Light'],
      ['checker', 'Alpha grid'],
    ],
    state.background,
    (value) => {
      state.background = value === 'light' || value === 'checker' ? value : 'dark';
    },
  );
  if (selected.kind === 'character') {
    const clips = new Map(
      entries.flatMap((entry) =>
        entry.kind === 'character' ? entry.clips.map((clip) => [clip.id, clip.label] as const) : [],
      ),
    );
    select('Animation', [...clips], state.clip, (value) => {
      state.clip = value;
      delete state.frame;
    });
    select(
      'Direction',
      ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'].map((label, index) => [String(index), label]),
      String(state.direction),
      (value) => {
        state.direction = Number(value);
      },
    );
    select(
      'Speed',
      [
        ['0.25', '¼×'],
        ['0.5', '½×'],
        ['1', '1×'],
        ['2', '2×'],
      ],
      String(state.speed),
      (value) => {
        state.speed = Number(value);
      },
    );
    const play = button(state.playing && state.frame === undefined ? 'Pause' : 'Play', () => {
      state.playing = !(state.playing && state.frame === undefined);
      delete state.frame;
      play.textContent = state.playing ? 'Pause' : 'Play';
      changed();
    });
    controls.append(play);
    const frameLabel = element('label', 'Frame');
    const frame = element('input');
    frame.type = 'number';
    frame.min = '0';
    frame.step = '1';
    frame.value = String(state.frame ?? 0);
    frame.addEventListener('change', () => {
      state.frame = Math.max(0, Math.floor(Number(frame.value) || 0));
      state.playing = false;
      play.textContent = 'Play';
      changed();
    });
    frameLabel.append(frame);
    controls.append(frameLabel);
  }
  if (selected.kind === 'building') {
    const wrapper = element('label', 'Construction');
    const progress = element('input');
    progress.type = 'range';
    progress.setAttribute('aria-label', 'Construction');
    progress.min = '0';
    progress.max = '100';
    progress.value = String(state.progress);
    progress.disabled = !entries.some((entry) => entry.kind === 'building' && entry.construction.length > 0);
    const value = element('output', `${state.progress}%`);
    progress.addEventListener('input', () => {
      state.progress = Number(progress.value);
      value.value = `${state.progress}%`;
      changed();
    });
    wrapper.append(progress, value);
    const missing = entries.filter((entry) => entry.kind === 'building' && entry.construction.length === 0);
    if (missing.length)
      wrapper.append(
        element(
          'small',
          `No authored construction layers: ${missing.map((entry) => entry.name).join(', ')}.`,
        ),
      );
    controls.append(wrapper);
  }
  if (selected.kind === 'material')
    select(
      'View',
      [
        ['atlas', 'Tiles & transitions'],
        ['repeat', 'Repeated ground'],
      ],
      state.terrainView,
      (value) => {
        state.terrainView = value === 'repeat' ? 'repeat' : 'atlas';
      },
    );
  return controls;
}
