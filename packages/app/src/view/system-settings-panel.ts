import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN, UI_SCALE_FACTOR_STEP } from '../hud/ui-scale.js';
import { messages } from '../i18n/index.js';
import type { GameSettingsRuntime } from './runtime/game-settings.js';
import type { SavePanelView } from './save-panels/index.js';
import { settingRow, sliderControl, togglePill } from './settings-controls.js';

const VOLUME_MIN = 0;
const VOLUME_MAX = 1;
const VOLUME_STEP = 0.01;

export interface SystemSettingsPanelDeps {
  readonly settings: GameSettingsRuntime;
  readonly showMenu: () => void;
  readonly panelStyle: string;
  readonly buttonStyle: string;
}

/** Settings whose runtime owners can apply them while the current world remains mounted. */
export function buildSystemSettingsPanel(deps: SystemSettingsPanelDeps): SavePanelView {
  const panel = document.createElement('div');
  panel.className = 'system-menu__settings';
  panel.style.cssText = deps.panelStyle;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.style.cssText = 'margin:0 0 10px;font:18px/1.2 ui-serif,Georgia,serif';

  const rows = document.createElement('div');
  rows.className = 'main-menu__settings-panel system-menu__settings-rows';

  const status = document.createElement('p');
  status.style.cssText = 'min-height:1.4em;margin:0;color:#e9b27d;font-size:13px';
  status.setAttribute('role', 'status');

  const back = document.createElement('button');
  back.type = 'button';
  back.style.cssText = deps.buttonStyle;
  back.addEventListener('click', deps.showMenu);

  let uiScaleCommit = 0;
  let renderVersion = 0;
  let uiScaleInput: HTMLInputElement | null = null;
  const render = (): void => {
    const restoreUiScaleFocus = document.activeElement === uiScaleInput;
    renderVersion++;
    const copy = messages();
    const text = copy.mainMenu.settings;
    const settings = deps.settings.current();
    const pinned = deps.settings.pinnedUiScale;
    title.textContent = copy.mainMenu.screenTitles.settings;
    panel.setAttribute('aria-label', title.textContent);
    back.textContent = `← ${copy.mainMenu.backLabels.main}`;

    const uiScale = sliderControl(text.uiScale, {
      min: UI_SCALE_FACTOR_MIN,
      max: UI_SCALE_FACTOR_MAX,
      step: UI_SCALE_FACTOR_STEP,
      value: settings.uiScaleFactor,
      disabled: pinned !== null,
      onCommit: (value) => {
        void applyUiScale(value);
      },
      format: (value) =>
        pinned === null
          ? `${Math.round(value * 100)}% (×${deps.settings.effectiveUiScaleFor(value).toFixed(2)})`
          : `×${pinned.toFixed(2)}`,
    });
    const sound = togglePill(settings.soundEnabled, (enabled) => {
      void deps.settings.update({ soundEnabled: enabled });
    });
    sound.setAttribute('aria-label', text.soundEnabled);
    const volume = (label: string, value: number, update: (value: number) => void): HTMLDivElement =>
      sliderControl(label, {
        min: VOLUME_MIN,
        max: VOLUME_MAX,
        step: VOLUME_STEP,
        value,
        onCommit: update,
        live: true,
      });

    rows.replaceChildren(
      settingRow(text.uiScale, uiScale, {
        tip: pinned === null ? text.uiScaleTip : text.uiScalePinnedTip,
      }),
      settingRow(text.soundEnabled, sound),
      settingRow(
        text.sfxVolume,
        volume(text.sfxVolume, settings.soundVolume, (value) => {
          void deps.settings.update({ soundVolume: value });
        }),
      ),
      settingRow(
        text.musicVolume,
        volume(text.musicVolume, settings.musicVolume, (value) => {
          void deps.settings.update({ musicVolume: value });
        }),
      ),
    );
    uiScaleInput = uiScale.querySelector<HTMLInputElement>('input[type="range"]');
    if (restoreUiScaleFocus) uiScaleInput?.focus();
  };

  panel.append(title, rows, status, back);

  const applyUiScale = async (value: number): Promise<void> => {
    const commit = ++uiScaleCommit;
    const startedRenderVersion = renderVersion;
    status.textContent = '';
    const applied = await deps.settings.update({ uiScaleFactor: value });
    if (commit !== uiScaleCommit) return;
    if (applied) {
      if (renderVersion !== startedRenderVersion) render();
      return;
    }
    render();
    status.textContent = messages().mainMenu.settings.uiScaleApplyFailed;
  };

  return {
    el: panel,
    open: () => {
      status.textContent = '';
      render();
    },
  };
}
