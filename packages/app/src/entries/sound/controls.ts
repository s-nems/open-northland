import {
  FAR_ZOOM_SCALE,
  type MixerVolumes,
  NEAR_ZOOM_SCALE,
  POOL_INSTANCE_CAP,
  VOLUME_CHANNELS,
  VOLUME_MAX,
  type VolumeChannel,
} from '@open-northland/audio';
import { formatMessage, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../../view/overlay.js';

/** The gallery's mixer and listener panel: the game's six volume sliders, where the listener stands
 *  (pan and camera zoom), the burst size, and a stop for music and beds. */

/** A burst's default size: past the pool cap and the sfx budget's burst, so both are heard. */
export const DEFAULT_BURST = 12;
/** The largest burst the size field takes. */
const MAX_BURST = 64;
/** The pan slider's travel either side of centre, in its steps. */
const PAN_STEPS = 100;
/** The zoom slider's resolution, in steps of camera scale. */
const ZOOM_STEP = 0.05;
/** Decimals the pan and zoom readouts show. */
const READOUT_DECIMALS = 2;

const CONTROLS_STYLE = [
  'position:sticky',
  'top:0',
  'z-index:1',
  'padding:10px 12px',
  'margin:12px 0',
  'background:#1d1610',
  'border:1px solid #5a4a36',
  'border-radius:8px',
].join(';');

/** Where the listener stands and how big a burst is; the rows read it on every play. */
export interface Listening {
  readonly volumes: Record<VolumeChannel, number>;
  pan: number;
  scale: number;
  burst: number;
}

export interface ListeningHooks {
  onVolumes(volumes: MixerVolumes): void;
  /** The pan or the zoom moved. */
  onListener(): void;
  onBurst(size: number): void;
  onStop(): void;
}

function slider(
  label: string,
  range: { readonly min: number; readonly max: number; readonly step: number },
  value: number,
  show: (v: number) => string,
  onInput: (v: number) => void,
): HTMLElement {
  const box = el('label', 'display:inline-flex;flex-direction:column;margin:0 14px 6px 0;font-size:12px');
  const caption = el('span', '', `${label}: ${show(value)}`);
  const input = el('input', 'width:140px');
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    caption.textContent = `${label}: ${show(v)}`;
    onInput(v);
  });
  box.append(caption, input);
  return box;
}

/** The panel, writing into `listening` and telling `hooks`; `tally` is the line under it that shows
 *  what the last play started. */
export function listeningControls(
  listening: Listening,
  hooks: ListeningHooks,
  tally: HTMLElement,
): HTMLElement {
  const copy = messages().soundGallery;
  const mixer = el('div', '');
  for (const channel of VOLUME_CHANNELS) {
    const range = { min: 0, max: VOLUME_MAX, step: 1 };
    mixer.append(
      slider(
        messages().mainMenu.settings.volumes[channel],
        range,
        listening.volumes[channel],
        String,
        (v) => {
          listening.volumes[channel] = v;
          hooks.onVolumes(listening.volumes);
        },
      ),
    );
  }
  const listen = el('div', '');
  const pan = { min: -PAN_STEPS, max: PAN_STEPS, step: 1 };
  const zoom = { min: FAR_ZOOM_SCALE, max: NEAR_ZOOM_SCALE, step: ZOOM_STEP };
  listen.append(
    slider(
      copy.pan,
      pan,
      listening.pan * PAN_STEPS,
      (v) => (v / PAN_STEPS).toFixed(READOUT_DECIMALS),
      (v) => {
        listening.pan = v / PAN_STEPS;
        hooks.onListener();
      },
    ),
    slider(
      copy.zoom,
      zoom,
      listening.scale,
      (v) => `×${v.toFixed(READOUT_DECIMALS)}`,
      (v) => {
        listening.scale = v;
        hooks.onListener();
      },
    ),
  );
  const burstSize = el('input', 'width:56px;margin-right:14px');
  burstSize.type = 'number';
  burstSize.min = '1';
  burstSize.max = String(MAX_BURST);
  burstSize.value = String(listening.burst);
  burstSize.addEventListener('change', () => {
    listening.burst = Math.min(MAX_BURST, Math.max(1, Math.trunc(Number(burstSize.value)) || 1));
    burstSize.value = String(listening.burst);
    hooks.onBurst(listening.burst);
  });
  const burstLabel = el('label', 'font-size:12px', `${copy.burstSize} `);
  burstLabel.append(burstSize);
  const stop = el('button', BUTTON_STYLE, copy.stopMusic);
  stop.addEventListener('click', () => hooks.onStop());
  listen.append(burstLabel, stop);

  const panel = el('div', CONTROLS_STYLE);
  panel.append(
    el('div', 'font-weight:700;margin-bottom:6px', copy.mixer),
    mixer,
    listen,
    el('div', 'opacity:0.65;font-size:12px', formatMessage(copy.poolCapNote, { cap: POOL_INSTANCE_CAP })),
    tally,
  );
  return panel;
}
