import {
  PIXEL_ART_SCALERS,
  type PixelArtScaler,
  SELECTION_STYLES,
  type SelectionStyle,
} from '@open-northland/render';
import { dropdownControl } from '../hud/dom/parts/dropdown.js';
import { MINIMAP_FRAME_IMAGES, MINIMAP_FRAMES, type MinimapFrame } from '../hud/minimap/frames.js';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN, UI_SCALE_FACTOR_STEP } from '../hud/ui-scale.js';
import { messages } from '../i18n/index.js';
import { segControl, settingRow, settingsHeading, sliderControl, togglePill } from './settings-controls.js';
import { cursorSettingsRows } from './settings-cursor-rows.js';
import type { DisplayMode } from './settings-display-mode.js';
import type { SettingsPageStore } from './settings-page.js';
import { type FpsLimit, type MenuSettings, RENDER_SCALE_MAX, RENDER_SCALE_MIN } from './settings-store.js';

type FpsChoice = 'fps30' | 'fps60' | 'screen';
const RENDER_SCALE_STEP = 0.25;

/** The art filter's four choices: `off` is the enhancement disabled, the other three name its scaler. */
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
    bilinear: text.pixelArtFilterSoft,
    sharp: text.pixelArtFilterSharp,
    xbr: text.pixelArtFilterXbr,
  };
  const filter = segControl<FilterChoice>(
    FILTER_CHOICES.map((id) => ({ id, label: filterLabels[id] })),
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
  const enhancementToggles = (
    [
      'softShadows',
      'enhancedWater',
      'environmentMotion',
      'groundedBuildings',
      'buildingDamage',
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
  return [
    settingsHeading(text.displayHeading),
    settingRow(text.displayMode, displaySeg.root),
    settingRow(text.uiScale, uiScale, {
      tip: store.pinnedUiScale === null ? text.uiScaleTip : text.uiScalePinnedTip,
    }),
    settingRow(text.renderScale, renderScale, { tip: deferredTip(text.renderScaleTip) }),
    settingRow(text.fpsLimit, fpsSeg.root, { tip: deferredTip(text.fpsLimitTip) }),
    ...cursorSettingsRows(store, markSegment),
    settingsHeading(text.interfaceHeading),
    settingRow(text.selectionStyle, selectionStyle.root, { tip: text.selectionStyleTip }),
    settingRow(text.groupNumbers, groupNumbers, { tip: liveTip(text.groupNumbersTip) }),
    settingRow(text.minimapFrame, minimapFrame.root, { tip: text.minimapFrameTip }),
    settingsHeading(text.worldHeading),
    settingRow(text.pixelArtFilter, filter.root, { tip: liveTip(text.pixelArtFilterTip) }),
    ...enhancementToggles,
    settingRow(text.spriteSmoothing, smoothing, { tip: deferredTip(text.spriteSmoothingTip) }),
    settingRow(text.postFx, postFx, { tip: deferredTip(text.postFxTip) }),
  ];
}
