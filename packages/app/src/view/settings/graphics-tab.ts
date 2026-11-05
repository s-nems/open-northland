import {
  PIXEL_ART_SCALERS,
  type PixelArtScaler,
  SELECTION_STYLES,
  type SelectionStyle,
} from '@open-northland/render';
import { dropdownControl } from '../../hud/dom/parts/dropdown.js';
import { MINIMAP_FRAME_IMAGES, MINIMAP_FRAMES, type MinimapFrame } from '../../hud/minimap/frames.js';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN, UI_SCALE_FACTOR_STEP } from '../../hud/ui-scale.js';
import { messages } from '../../i18n/index.js';
import { segControl, settingRow, settingsHeading, sliderControl, togglePill } from './controls.js';
import { cursorSettingsRows } from './cursor-rows.js';
import { enhancePlayerColor } from '../../catalog/player-color.js';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { applyColorBlindFilter, correctionMatrix } from '../accessibility/colorblind-filter.js';
import type { DisplayMode } from './display-mode.js';
import type { SettingsPageStore } from './page.js';
import {
  type ColorBlindFilter,
  COLOR_BLIND_FILTERS,
  type FpsLimit,
  type MenuSettings,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
  TEAM_COLOR_STRENGTH_MAX,
  TEAM_COLOR_STRENGTH_MIN,
} from './store.js';

type FpsChoice = 'fps30' | 'fps60' | 'screen';
const RENDER_SCALE_STEP = 0.25;

/** The art filter's choices: `off` is the enhancement disabled, the others name its scaler. */
export type FilterChoice = PixelArtScaler | 'off';
export const FILTER_CHOICES: readonly FilterChoice[] = ['off', ...PIXEL_ART_SCALERS];

/** The choice a stored pair shows as. */
export const filterChoiceOf = (
  settings: Pick<MenuSettings, 'enhancedSampling' | 'pixelArtScaler'>,
): FilterChoice => (settings.enhancedSampling ? settings.pixelArtScaler : 'off');

/** The patch a choice writes. `off` leaves the stored scaler alone, so turning the filter back on
 *  returns the player's own choice instead of the default. */
export const filterPatchFor = (choice: FilterChoice): Partial<MenuSettings> =>
  choice === 'off' ? { enhancedSampling: false } : { enhancedSampling: true, pixelArtScaler: choice };
const fpsChoiceOf = (limit: FpsLimit): FpsChoice =>
  limit === 30 ? 'fps30' : limit === 60 ? 'fps60' : 'screen';
const fpsLimitOf = (choice: FpsChoice): FpsLimit =>
  choice === 'fps30' ? 30 : choice === 'fps60' ? 60 : null;

export function graphicsSettingsRows(
  store: SettingsPageStore,
  liveDisplayMode: () => DisplayMode,
  requestDisplayMode: (mode: DisplayMode) => void,
  applyUiScale: (value: number) => Promise<void>,
  markSegment: (root: HTMLElement, prefix: string) => void,
): HTMLElement[] {
  const text = messages().mainMenu.settings;
  const deferredTip = (tip: string): string =>
    store.bootOwnedChangesDeferred === true ? `${tip} ${text.nextGameTip}` : tip;
  // The same signal, read the other way: only the in-game page has a world for a change to reach now.
  const liveTip = (tip: string): string =>
    store.bootOwnedChangesDeferred === true ? `${tip} ${text.liveTip}` : tip;
  const settings = store.current();
  const displaySeg = segControl<DisplayMode>(
    [
      { id: 'fullscreen', label: text.displayFullscreen },
      { id: 'window', label: text.displayWindow },
    ],
    liveDisplayMode(),
    (mode) => {
      requestDisplayMode(mode);
    },
  );
  markSegment(displaySeg.root, 'display');
  const uiScale = sliderControl(text.uiScale, {
    min: UI_SCALE_FACTOR_MIN,
    max: UI_SCALE_FACTOR_MAX,
    step: UI_SCALE_FACTOR_STEP,
    value: settings.uiScaleFactor,
    disabled: store.pinnedUiScale !== null,
    onCommit: (value) => {
      void applyUiScale(value);
    },
    format: (value) =>
      store.pinnedUiScale === null
        ? `${Math.round(value * 100)}% (×${store.effectiveUiScaleFor(value).toFixed(2)})`
        : `×${store.pinnedUiScale.toFixed(2)}`,
  });
  const uiScaleInput = uiScale.querySelector<HTMLInputElement>('input[type="range"]');
  if (uiScaleInput !== null) uiScaleInput.dataset.settingsFocus = 'ui-scale';
  const renderScale = sliderControl(text.renderScale, {
    min: RENDER_SCALE_MIN,
    max: RENDER_SCALE_MAX,
    step: RENDER_SCALE_STEP,
    value: settings.renderScale,
    onCommit: (value) => {
      void store.update({ renderScale: value });
    },
  });
  const renderScaleInput = renderScale.querySelector<HTMLInputElement>('input[type="range"]');
  if (renderScaleInput !== null) renderScaleInput.dataset.settingsFocus = 'render-scale';
  const integerScaling = togglePill(settings.integerScaling, (enabled) => {
    void store.update({ integerScaling: enabled });
  });
  integerScaling.setAttribute('aria-label', text.integerScaling);
  integerScaling.dataset.settingsFocus = 'integer-scaling';
  const fpsSeg = segControl<FpsChoice>(
    [
      { id: 'fps30', label: '30 FPS' },
      { id: 'fps60', label: '60 FPS' },
      { id: 'screen', label: text.fpsLimitScreen },
    ],
    fpsChoiceOf(settings.fpsLimit),
    (choice) => {
      void store.update({ fpsLimit: fpsLimitOf(choice) });
      fpsSeg.setActive(choice);
    },
  );
  markSegment(fpsSeg.root, 'fps');
  const postFx = togglePill(settings.postFxEnabled, (enabled) => {
    void store.update({ postFxEnabled: enabled });
  });
  postFx.setAttribute('aria-label', text.postFx);
  postFx.dataset.settingsFocus = 'post-fx';
  const smoothing = togglePill(settings.spriteSmoothing, (enabled) => {
    void store.update({ spriteSmoothing: enabled });
  });
  smoothing.setAttribute('aria-label', text.spriteSmoothing);
  smoothing.dataset.settingsFocus = 'sprite-smoothing';
  const filterLabels: Readonly<Record<FilterChoice, string>> = {
    off: text.pixelArtFilterOff,
    xbr: text.pixelArtFilterXbr,
    xbrz: text.pixelArtFilterXbrz,
    superxbr: text.pixelArtFilterSuperXbr,
    mmpx: text.pixelArtFilterMmpx,
  };
  const filterTips: Readonly<Record<FilterChoice, string>> = {
    off: text.pixelArtFilterOffTip,
    xbr: text.pixelArtFilterXbrTip,
    xbrz: text.pixelArtFilterXbrzTip,
    superxbr: text.pixelArtFilterSuperXbrTip,
    mmpx: text.pixelArtFilterMmpxTip,
  };
  const filter = segControl<FilterChoice>(
    FILTER_CHOICES.map((id) => ({ id, label: filterLabels[id], tip: filterTips[id] })),
    filterChoiceOf(settings),
    (choice) => {
      void store.update(filterPatchFor(choice));
      filter.setActive(choice);
    },
  );
  markSegment(filter.root, 'pixel-art-filter');
  const selectionStyle = segControl<SelectionStyle>(
    SELECTION_STYLES.map((id) => ({ id, label: text.selectionStyles[id] })),
    settings.selectionStyle,
    (style) => {
      void store.update({ selectionStyle: style });
      selectionStyle.setActive(style);
    },
  );
  markSegment(selectionStyle.root, 'selection-style');
  selectionStyle.root.classList.add('main-menu__selection-styles');
  const hoverOutline = togglePill(settings.hoverOutline, (enabled) => {
    void store.update({ hoverOutline: enabled });
  });
  hoverOutline.setAttribute('aria-label', text.hoverOutline);
  hoverOutline.dataset.settingsFocus = 'hoverOutline';
  const cursorHints = togglePill(settings.cursorHints, (enabled) => {
    void store.update({ cursorHints: enabled });
  });
  cursorHints.setAttribute('aria-label', text.cursorHints);
  cursorHints.dataset.settingsFocus = 'cursorHints';
  const minimapFrame = dropdownControl<MinimapFrame>({
    label: text.minimapFrame,
    className: 'main-menu__dropdown',
    entries: MINIMAP_FRAMES.map((id) => ({
      id,
      label: text.minimapFrames[id],
      image: MINIMAP_FRAME_IMAGES[id],
    })),
    active: settings.minimapFrame,
    onPick: (frame) => {
      void store.update({ minimapFrame: frame });
      minimapFrame.setActive(frame);
    },
  });
  minimapFrame.root.classList.add('main-menu__minimap-frames');
  const groupNumbers = togglePill(settings.groupNumbers, (enabled) => {
    void store.update({ groupNumbers: enabled });
  });
  groupNumbers.setAttribute('aria-label', text.groupNumbers);
  groupNumbers.dataset.settingsFocus = 'groupNumbers';
  const fpsCounter = togglePill(settings.fpsCounter, (enabled) => {
    void store.update({ fpsCounter: enabled });
  });
  fpsCounter.setAttribute('aria-label', text.fpsCounter);
  fpsCounter.dataset.settingsFocus = 'fpsCounter';
  const enhancementToggles = (
    [
      'softShadows',
      'enhancedWater',
      'environmentMotion',
      'groundedBuildings',
      'buildingDamage',
      'nightLights',
      'weather',
      'blood',
      'bonesFade',
    ] as const
  ).map((key) => {
    const toggle = togglePill(settings[key], (enabled) => {
      void store.update({ [key]: enabled });
    });
    toggle.setAttribute('aria-label', text[key]);
    toggle.dataset.settingsFocus = key;
    return settingRow(text[key], toggle, { tip: liveTip(text[`${key}Tip`]) });
  });
  const teamColorStrength = sliderControl(text.teamColorStrength, {
    min: TEAM_COLOR_STRENGTH_MIN,
    max: TEAM_COLOR_STRENGTH_MAX,
    step: 1,
    value: settings.teamColorStrength,
    live: true,
    onCommit: (value) => {
      void store.update({ teamColorStrength: value });
    },
  });
  // A live preview: the player-colour swatches grow bolder as the strength rises, so the effect is
  // visible without leaving the settings screen. Hue is untouched; only saturation and value shift.
  const TEAM_COLOR_SAMPLE = [0, 1, 2, 3, 4, 5, 6, 7];
  const preview = document.createElement('div');
  preview.style.display = 'flex';
  preview.style.flexWrap = 'wrap';
  preview.style.gap = '4px';
  preview.style.marginTop = '6px';
  const chips = TEAM_COLOR_SAMPLE.map((id) => {
    const chip = document.createElement('span');
    chip.style.width = '26px';
    chip.style.height = '16px';
    chip.style.borderRadius = '3px';
    chip.style.border = '1px solid rgba(255, 255, 255, 0.25)';
    preview.append(chip);
    return chip;
  });
  const paintPreview = (strength: number): void => {
    TEAM_COLOR_SAMPLE.forEach((id, i) => {
      const hex = enhancePlayerColor(PLAYER_SWATCH_COLORS[id] ?? 0, strength);
      chips[i]!.style.backgroundColor = `#${hex.toString(16).padStart(6, '0')}`;
    });
  };
  paintPreview(settings.teamColorStrength);
  const teamStrengthInput = teamColorStrength.querySelector<HTMLInputElement>('input');
  teamStrengthInput?.addEventListener('input', () => paintPreview(Number(teamStrengthInput.value)));
  // Full-width, left-aligned preview so it lines up with the colour-blind preview below.
  preview.style.marginTop = '4px';
  preview.style.marginBottom = '2px';
  const colorBlindLabels: Readonly<Record<ColorBlindFilter, string>> = {
    off: text.colorBlindFilterOff,
    deuteranopia: text.colorBlindFilterDeuteranopia,
    protanopia: text.colorBlindFilterProtanopia,
    tritanopia: text.colorBlindFilterTritanopia,
    generic: text.colorBlindFilterGeneric,
  };
  const colorBlindFilter = segControl<ColorBlindFilter>(
    COLOR_BLIND_FILTERS.map((id) => ({ id, label: colorBlindLabels[id] })),
    settings.colorBlindFilter,
    (choice) => {
      void store.update({ colorBlindFilter: choice });
      colorBlindFilter.setActive(choice);
      applyColorBlindFilter(choice);
      paintFilterPreview(choice);
    },
  );
  markSegment(colorBlindFilter.root, 'color-blind-filter');
  // A live preview: how the chosen correction reshapes representative hues, visible without leaving the
  // settings screen. `off` shows the raw colours; the screen-wide filter applies the same maths.
  const applyCorrection = (hex: number, matrix: readonly number[]): number => {
    const r = ((hex >> 16) & 0xff) / 0xff;
    const g = ((hex >> 8) & 0xff) / 0xff;
    const b = (hex & 0xff) / 0xff;
    const clamp = (v: number): number => Math.max(0, Math.min(0xff, Math.round(v * 0xff)));
    const at = (i: number): number => matrix[i] ?? 0;
    return (
      (clamp(r * at(0) + g * at(1) + b * at(2)) << 16) |
      (clamp(r * at(5) + g * at(6) + b * at(7)) << 8) |
      clamp(r * at(10) + g * at(11) + b * at(12))
    );
  };
  const FILTER_SAMPLE = [0xff0000, 0x00c000, 0x0000ff, 0xffc000, 0xff8000, 0x00c0c0, 0x800080, 0x00e000];
  const filterPreview = document.createElement('div');
  filterPreview.style.display = 'flex';
  filterPreview.style.flexWrap = 'wrap';
  filterPreview.style.gap = '4px';
  filterPreview.style.marginTop = '6px';
  const filterChips = FILTER_SAMPLE.map(() => {
    const chip = document.createElement('span');
    chip.style.width = '26px';
    chip.style.height = '16px';
    chip.style.borderRadius = '3px';
    chip.style.border = '1px solid rgba(255, 255, 255, 0.25)';
    filterPreview.append(chip);
    return chip;
  });
  const paintFilterPreview = (filter: ColorBlindFilter): void => {
    const matrix = correctionMatrix(filter);
    FILTER_SAMPLE.forEach((hex, i) => {
      const corrected = matrix === undefined ? hex : applyCorrection(hex, matrix);
      filterChips[i]!.style.backgroundColor = `#${corrected.toString(16).padStart(6, '0')}`;
    });
  };
  paintFilterPreview(settings.colorBlindFilter);
  // Full-width, left-aligned preview so it lines up with the team-colour preview above.
  filterPreview.style.marginTop = '4px';
  filterPreview.style.marginBottom = '2px';
  return [
    settingsHeading(text.displayHeading),
    settingRow(text.displayMode, displaySeg.root),
    settingRow(text.uiScale, uiScale, {
      tip: store.pinnedUiScale === null ? text.uiScaleTip : text.uiScalePinnedTip,
    }),
    settingRow(text.renderScale, renderScale, { tip: deferredTip(text.renderScaleTip) }),
    settingRow(text.integerScaling, integerScaling, { tip: text.integerScalingTip }),
    settingRow(text.fpsLimit, fpsSeg.root, { tip: liveTip(text.fpsLimitTip) }),
    ...cursorSettingsRows(store, markSegment),
    settingsHeading(text.interfaceHeading),
    settingRow(text.selectionStyle, selectionStyle.root, { tip: text.selectionStyleTip }),
    settingRow(text.hoverOutline, hoverOutline, { tip: liveTip(text.hoverOutlineTip) }),
    settingRow(text.cursorHints, cursorHints, { tip: liveTip(text.cursorHintsTip) }),
    settingRow(text.groupNumbers, groupNumbers, { tip: liveTip(text.groupNumbersTip) }),
    settingRow(text.minimapFrame, minimapFrame.root, { tip: text.minimapFrameTip }),
    settingRow(text.fpsCounter, fpsCounter, { tip: liveTip(text.fpsCounterTip) }),
    settingsHeading(text.worldHeading),
    settingRow(text.pixelArtFilter, filter.root, { tip: liveTip(text.pixelArtFilterTip) }),
    ...enhancementToggles,
    settingRow(text.spriteSmoothing, smoothing, { tip: deferredTip(text.spriteSmoothingTip) }),
    settingRow(text.postFx, postFx, { tip: deferredTip(text.postFxTip) }),
    settingsHeading(text.accessibilityHeading),
    settingRow(text.teamColorStrength, teamColorStrength, { tip: liveTip(text.teamColorStrengthTip) }),
    preview,
    settingRow(text.colorBlindFilter, colorBlindFilter.root, { tip: liveTip(text.colorBlindFilterTip) }),
    filterPreview,
  ];
}
