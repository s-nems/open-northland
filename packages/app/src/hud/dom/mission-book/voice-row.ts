import type { NarrationState, UiCue } from '@open-northland/audio';
import { type BriefingVoice, callbackVoice } from '@open-northland/data';
import { messages } from '../../../i18n/index.js';
import { createTooltip } from '../../../view/tooltip.js';
import { escapeHtml, setAttribute, setStyleVar, setTip } from '../parts/dom.js';
import { attachTipLayer } from '../parts/tip-layer.js';
import type { BookPage } from './page-segments.js';

/** The narration line and the briefing clip it speaks; `waiting` also covers a clip still loading. */
export interface BriefingVoiceState extends NarrationState {
  readonly voice: BriefingVoice | null;
}

/** Plays one briefing narration line at a time, with the transport the page's player drives; a missing
 *  clip is silent. */
export interface BriefingVoicePlayer {
  /** The map ships `voice`'s clip. */
  has(voice: BriefingVoice): boolean;
  play(voice: BriefingVoice): void;
  stop(): void;
  /** Start `voice` when another or none is current, else pause or resume it. */
  toggle(voice: BriefingVoice): void;
  /** Move `voice` to `atS` when it is the current line. */
  seek(voice: BriefingVoice, atS: number): void;
  state(): BriefingVoiceState;
}

/** Arrow keys on the seek bar move the narration this far. */
export const VOICE_KEY_STEP_S = 5;
const SECONDS_PER_MINUTE = 60;

export const sameVoice = (a: BriefingVoice | null, b: BriefingVoice): boolean =>
  a !== null && a.lang === b.lang && a.id === b.id;

/** The narration a chapter's player drives: the clip of its last voice callback, which the spread
 *  showing that callback speaks. Null, and no player, when the page speaks none the map ships. */
export function chapterVoice(
  page: BookPage,
  lang: string | null,
  player: BriefingVoicePlayer | null,
): BriefingVoice | null {
  if (player === null) return null;
  for (let i = page.callbacks.length - 1; i >= 0; i--) {
    const args = page.callbacks[i]?.args;
    const voice = args === undefined ? null : callbackVoice(lang, args);
    if (voice !== null) return player.has(voice) ? voice : null;
  }
  return null;
}

/** What the player row shows for `voice`: a line of another clip reads as not started. */
export interface VoiceRowView {
  readonly playing: boolean;
  readonly positionS: number;
  /** 0 while the clip's length is unknown. */
  readonly durationS: number;
  /** Elapsed share of the clip, 0..1. */
  readonly at: number;
}

export function voiceRowView(state: BriefingVoiceState, voice: BriefingVoice): VoiceRowView {
  if (!sameVoice(state.voice, voice)) return { playing: false, positionS: 0, durationS: 0, at: 0 };
  const { status, positionS, durationS } = state;
  return {
    playing: status === 'playing' || status === 'waiting',
    positionS,
    durationS,
    at: durationS > 0 ? Math.min(1, positionS / durationS) : 0,
  };
}

/** `m:ss`; an unknown length reads as dashes. */
export function clockText(seconds: number | null): string {
  if (seconds === null) return '–:––';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  return `${minutes}:${String(whole % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

const timeText = (view: VoiceRowView): string =>
  `${clockText(view.positionS)} / ${clockText(view.durationS > 0 ? view.durationS : null)}`;

const GLYPHS =
  '<svg class="on-voice__glyph" viewBox="0 0 16 16" aria-hidden="true"><path class="on-voice__play" d="M5.5 3.2v9.6l7.6-4.8z"/><path class="on-voice__pause" d="M4.6 3.4h2.3v9.2H4.6zM9.1 3.4h2.3v9.2H9.1z"/></svg>';

export interface VoiceRows {
  /** The player row a voiced chapter's foot carries on every spread. */
  markup(): string;
  /** Once a frame while the book shows: follow the narration line. */
  refresh(spread: HTMLElement): void;
  /** The book closed: no tooltip stays up. */
  hide(): void;
  dispose(): void;
}

export interface VoiceRowsDeps {
  /** The book scene the rows sit in; it routes their input. */
  readonly scene: HTMLElement;
  readonly player: BriefingVoicePlayer | null;
  /** The voice of the chapter shown, null on a page without one. */
  readonly voice: () => BriefingVoice | null;
  readonly cue: (cue: UiCue) => void;
}

/** The briefing chapter's narration player: a play/pause toggle, a seek bar and the elapsed and total
 *  time, in the book's foot, so it stays in reach while the reader turns the chapter's pages. */
export function createVoiceRows(deps: VoiceRowsDeps): VoiceRows {
  const copy = messages().hud.missionBook;
  const chip = createTooltip();
  const tips = attachTipLayer(deps.scene, chip);
  /** A seek bar being dragged, and where the drag stands (0..1); the line follows on release. */
  let drag: { readonly bar: HTMLElement; at: number } | null = null;
  let shownKey = '';

  const current = (): { voice: BriefingVoice; view: VoiceRowView } | null => {
    const voice = deps.voice();
    return deps.player === null || voice === null
      ? null
      : { voice, view: voiceRowView(deps.player.state(), voice) };
  };

  const paint = (row: HTMLElement, view: VoiceRowView): void => {
    row.dataset.state = view.playing ? 'playing' : 'paused';
    setStyleVar(row, '--voice-at', view.at.toFixed(4));
    const toggle = row.querySelector<HTMLElement>('[data-voice-toggle]');
    if (toggle !== null) {
      const label = view.playing ? copy.voicePause : copy.voicePlay;
      setAttribute(toggle, 'aria-label', label);
      setTip(toggle, label);
    }
    const bar = row.querySelector<HTMLElement>('.on-voice__bar');
    const text = timeText(view);
    if (bar !== null) {
      setAttribute(bar, 'aria-valuemax', String(Math.round(view.durationS)));
      setAttribute(bar, 'aria-valuenow', String(Math.round(view.positionS)));
      setAttribute(bar, 'aria-valuetext', text);
    }
    const time = row.querySelector('.on-voice__time');
    if (time !== null && time.textContent !== text) time.textContent = text;
  };

  const rowsIn = (spread: HTMLElement): NodeListOf<HTMLElement> =>
    spread.querySelectorAll<HTMLElement>('.on-voice');

  const barShare = (bar: HTMLElement, clientX: number): number => {
    const box = bar.getBoundingClientRect();
    return box.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  };

  const seekTo = (voice: BriefingVoice, atS: number): void => {
    deps.player?.seek(voice, atS);
    shownKey = '';
  };

  const toggle = (): void => {
    const voice = deps.voice();
    if (voice === null || deps.player === null) return;
    deps.cue('confirm');
    deps.player.toggle(voice);
    shownKey = '';
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-voice-toggle]') != null) toggle();
  };
  const onPointerDown = (event: PointerEvent): void => {
    const bar = event.target instanceof Element ? event.target.closest<HTMLElement>('.on-voice__bar') : null;
    const shown = current();
    if (bar === null || shown === null || shown.view.durationS === 0 || event.button !== 0) return;
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    bar.focus({ preventScroll: true });
    drag = { bar, at: barShare(bar, event.clientX) };
    bar.closest('.on-voice')?.classList.add('on-voice--drag');
    const row = bar.closest<HTMLElement>('.on-voice');
    if (row !== null) setStyleVar(row, '--voice-at', drag.at.toFixed(4));
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (drag === null) return;
    drag.at = barShare(drag.bar, event.clientX);
    const row = drag.bar.closest<HTMLElement>('.on-voice');
    const shown = current();
    if (row === null || shown === null) return;
    paint(row, { ...shown.view, at: drag.at, positionS: drag.at * shown.view.durationS });
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (drag === null) return;
    const { bar, at } = drag;
    drag = null;
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    bar.closest('.on-voice')?.classList.remove('on-voice--drag');
    const shown = current();
    if (shown !== null && event.type === 'pointerup') seekTo(shown.voice, at * shown.view.durationS);
    shownKey = '';
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.on-voice') == null) return;
    const shown = current();
    if (shown === null) return;
    const onBar = target.closest('.on-voice__bar') !== null;
    let handled = true;
    if (event.key === ' ') toggle();
    else if (onBar && event.key === 'ArrowLeft') seekTo(shown.voice, shown.view.positionS - VOICE_KEY_STEP_S);
    else if (onBar && event.key === 'ArrowRight')
      seekTo(shown.voice, shown.view.positionS + VOICE_KEY_STEP_S);
    else if (onBar && event.key === 'Home') seekTo(shown.voice, 0);
    else handled = false;
    if (!handled) return;
    // The map's own keys (camera arrows, pause on Space) stay with the player while it has focus.
    event.preventDefault();
    event.stopPropagation();
  };
  deps.scene.addEventListener('click', onClick);
  deps.scene.addEventListener('pointerdown', onPointerDown);
  deps.scene.addEventListener('pointermove', onPointerMove);
  deps.scene.addEventListener('pointerup', onPointerUp);
  deps.scene.addEventListener('pointercancel', onPointerUp);
  deps.scene.addEventListener('keydown', onKeyDown);

  return {
    markup(): string {
      // A new row starts unpainted, so the next refresh paints it whatever it showed before.
      shownKey = '';
      return `<div class="on-voice" role="group" aria-label="${escapeHtml(copy.voiceLabel)}" data-state="paused">
      <button type="button" class="on-voice__toggle" data-voice-toggle aria-label="${escapeHtml(copy.voicePlay)}">${GLYPHS}</button>
      <div class="on-voice__bar" role="slider" tabindex="0" aria-label="${escapeHtml(copy.voiceSeek)}" data-tip="${escapeHtml(copy.voiceSeek)}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span class="on-voice__track"><span class="on-voice__fill"></span></span><span class="on-voice__handle"></span></div>
      <span class="on-voice__time">${escapeHtml(clockText(0))} / ${escapeHtml(clockText(null))}</span>
    </div>`;
    },
    refresh(spread): void {
      tips.refresh();
      const shown = current();
      if (shown === null || drag !== null) return;
      const { view } = shown;
      const key = `${view.playing}:${view.at.toFixed(4)}:${Math.floor(view.positionS)}:${view.durationS}`;
      if (key === shownKey) return;
      shownKey = key;
      for (const row of rowsIn(spread)) paint(row, view);
    },
    hide: () => tips.hide(),
    dispose(): void {
      deps.scene.removeEventListener('click', onClick);
      deps.scene.removeEventListener('pointerdown', onPointerDown);
      deps.scene.removeEventListener('pointermove', onPointerMove);
      deps.scene.removeEventListener('pointerup', onPointerUp);
      deps.scene.removeEventListener('pointercancel', onPointerUp);
      deps.scene.removeEventListener('keydown', onKeyDown);
      tips.dispose();
      chip.destroy();
    },
  };
}
