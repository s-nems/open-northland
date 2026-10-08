import type { VoiceClass } from '@open-northland/data';
import { type Camera, halfCellToScreen } from '@open-northland/render/data';
import { entityById, type HalfCellNode, type WorldSnapshot } from '@open-northland/sim';
import { groupFiles, poolGain, type SoundIndex } from './bank.js';
import { VOICE_MUSIC_DUCK_DB } from './mixer.js';
import { voiceClassOf } from './snapshot.js';
import type { Lane, NoticeVoiceSound, OneShot, SoundBindings } from './types.js';
import { UI_CUE_GAIN } from './ui-cues.js';

/**
 * Attack alerts and the notices' own sounds. The original sounds no attack alert at all, only its
 * attack music, so the horn here is an authored improvement: it rings for an attack on the local seat
 * the player is not looking at, at most once per {@link ATTACK_ALERT_INTERVAL_S} per place, and sooner
 * for a new front. Pure: time comes in as `now` (audio-clock seconds).
 */

/** Where the seat is hit: its settlement (a building, or bodies among its buildings), or its people out
 *  in the field. */
export type AttackFront = 'base' | 'units';

/** One frame's hits on the seat in one fight, at the latest hit's node. */
export interface AttackReport {
  readonly front: AttackFront;
  readonly at: HalfCellNode;
}

/** A settler's notice that speaks in its own voice: `weary` for an idle or tired worker (a yawn),
 *  `hungry` for one going without food (a sigh). */
export type NoticeVoice = 'weary' | 'hungry';

/** What rings in the alert lane besides the jingles ({@link Lane}). */
export type AlertKind = 'baseAttacked' | 'unitsAttacked' | NoticeVoice;

/** The view an alert is judged against: what the camera shows now. */
export interface AlertView {
  readonly camera: Camera;
  readonly canvasW: number;
  readonly canvasH: number;
}

/** Least seconds before one place alerts again while it stays under attack off screen. From a published
 *  RTS editor's attack-notification minimum interval (30 s). */
export const ATTACK_ALERT_INTERVAL_S = 30;
/** How far, in world px at 1:1, a hit must lie from every place alerted or watched within the interval
 *  to count as a new front that alerts at once: about one screen (a 1280 px wide view). Approximation
 *  of the same editor's minimum-range rule. */
export const ATTACK_ALERT_NEW_FRONT_PX = 1280;
/** Least seconds between two alerts of any front, so fronts opening together sound one horn and the
 *  rest wait for the next frame past it. Approximation. */
export const ATTACK_ALERT_MIN_GAP_S = 5;
/** The horn's gain per front: an attack inside the settlement at the GUI's full level, people hit in
 *  the field about 6 dB under it. Authored, tune by ear. */
export const ATTACK_ALERT_GAIN: Readonly<Record<AttackFront, number>> = {
  base: UI_CUE_GAIN,
  units: UI_CUE_GAIN / 2,
};
/** dB the world and ambient buses dip while an alert rings, so the horn reads over a battle. Authored:
 *  the common "a few dB" alert duck. */
export const ALERT_DUCK_DB = -4;
/** Least seconds between two sounds of one notice key (a message type, a notice voice). Approximation:
 *  a busy settlement raises the same note for many settlers in a row. */
export const NOTICE_CUE_INTERVAL_S = 20;

const FRONT_ALERT: Readonly<Record<AttackFront, AlertKind>> = {
  base: 'baseAttacked',
  units: 'unitsAttacked',
};
/** A front outranks another when its settlement is in danger; a base hit after a field alert escalates. */
const FRONT_RANK: Readonly<Record<AttackFront, number>> = { units: 0, base: 1 };

/** A place alerted or seen on screen, in world px at 1:1, and when. */
interface KnownFront {
  readonly x: number;
  readonly y: number;
  front: AttackFront;
  at: number;
}

function onScreen(p: { readonly x: number; readonly y: number }, view: AlertView): boolean {
  const scale = view.camera.scale ?? 1;
  const sx = p.x * scale + view.camera.offsetX;
  const sy = p.y * scale + view.camera.offsetY;
  return sx >= 0 && sx <= view.canvasW && sy >= 0 && sy <= view.canvasH;
}

/**
 * Which of a frame's attacks sounds the alert. A hit on screen sounds nothing (the player is watching)
 * and marks its place as seen, so turning away from it does not sound the horn either. An off-screen
 * hit alerts unless a place within {@link ATTACK_ALERT_NEW_FRONT_PX} of it was alerted or watched within
 * {@link ATTACK_ALERT_INTERVAL_S} on a front at least as grave.
 */
export class AttackAlerts {
  private fronts: KnownFront[] = [];
  private lastAlert = Number.NEGATIVE_INFINITY;

  decide(reports: readonly AttackReport[], view: AlertView, now: number): AttackReport | null {
    if (this.fronts.some((f) => now - f.at >= ATTACK_ALERT_INTERVAL_S)) {
      this.fronts = this.fronts.filter((f) => now - f.at < ATTACK_ALERT_INTERVAL_S);
    }
    let best: { readonly report: AttackReport; readonly x: number; readonly y: number } | null = null;
    for (const report of reports) {
      const p = halfCellToScreen(report.at.hx, report.at.hy);
      const near = this.fronts.filter((f) => Math.hypot(f.x - p.x, f.y - p.y) < ATTACK_ALERT_NEW_FRONT_PX);
      if (onScreen(p, view)) {
        for (const f of near) {
          f.at = now;
          if (FRONT_RANK[report.front] > FRONT_RANK[f.front]) f.front = report.front;
        }
        if (near.length === 0) this.fronts.push({ ...p, front: report.front, at: now });
        continue;
      }
      if (near.some((f) => FRONT_RANK[f.front] >= FRONT_RANK[report.front])) continue;
      if (best === null || FRONT_RANK[report.front] > FRONT_RANK[best.report.front]) {
        best = { report, x: p.x, y: p.y };
      }
    }
    if (best === null || now - this.lastAlert < ATTACK_ALERT_MIN_GAP_S) return null;
    this.lastAlert = now;
    this.fronts.push({ x: best.x, y: best.y, front: best.report.front, at: now });
    return best.report;
  }
}

/** Admits one sound per key per {@link NOTICE_CUE_INTERVAL_S}. */
export class NoticeCueGate {
  private readonly lastRing = new Map<string, number>();

  admit(key: string, now: number): boolean {
    const last = this.lastRing.get(key);
    if (last !== undefined && now - last < NOTICE_CUE_INTERVAL_S) return false;
    this.lastRing.set(key, now);
    return true;
  }
}

/** The alert lane entry of `alert`. */
export function alertLane(alert: AlertKind): Lane {
  return { kind: 'alert', alert };
}

/** The horn of an attack on `front`, centred on the ui bus, ducking the world and the music under it;
 *  null when the bindings name no alert group or the bank lacks it. */
export function attackAlertShot(
  index: SoundIndex,
  bindings: SoundBindings,
  front: AttackFront,
): OneShot | null {
  const files = bindings.attackAlert === undefined ? undefined : groupFiles(index, bindings.attackAlert);
  if (files === undefined) return null;
  const alert = FRONT_ALERT[front];
  return {
    files,
    gain: ATTACK_ALERT_GAIN[front],
    pan: 0,
    key: `alert:${alert}`,
    lane: alertLane(alert),
    duckWorldDb: ALERT_DUCK_DB,
    duckMusicDb: VOICE_MUSIC_DUCK_DB,
  };
}

function noticeVoiceFiles(index: SoundIndex, sound: NoticeVoiceSound): readonly string[] | undefined {
  if ('group' in sound) return groupFiles(index, sound.group);
  return sound.files.length > 0 ? sound.files : undefined;
}

/** The line a settler's `voice` notice speaks in its class's voice, centred in the alert lane; null for
 *  a settler gone from the snapshot or a class the bindings leave silent (a child). */
export function noticeVoiceShot(
  index: SoundIndex,
  bindings: SoundBindings,
  snapshot: WorldSnapshot,
  voice: NoticeVoice,
  settler: number,
): OneShot | null {
  const e = entityById(snapshot, settler);
  if (e === undefined) return null;
  const voiceClass: VoiceClass = voiceClassOf(e.components);
  const sound = bindings.noticeVoices?.[voice][voiceClass];
  const files = sound === undefined ? undefined : noticeVoiceFiles(index, sound);
  if (files === undefined) return null;
  return {
    files,
    gain: poolGain(index, files),
    pan: 0,
    key: `notice:${voice}`,
    lane: alertLane(voice),
    duckMusicDb: VOICE_MUSIC_DUCK_DB,
  };
}

/** A settler's notice voice waiting for the next frame's snapshot. */
interface SpokenNotice {
  readonly voice: NoticeVoice;
  readonly settler: number;
}

/**
 * The alerts and notice voices reported since the last frame, turned into one-shots on the next one,
 * which knows the camera and the settlers. A notice voice speaks once per {@link NOTICE_CUE_INTERVAL_S};
 * the attacks go through {@link AttackAlerts}.
 */
export class AlertDesk {
  private attacks: AttackReport[] = [];
  private spoken: SpokenNotice[] = [];
  private readonly alerts = new AttackAlerts();
  private readonly gate = new NoticeCueGate();

  reportAttack(report: AttackReport): void {
    this.attacks.push(report);
  }

  speak(voice: NoticeVoice, settler: number): void {
    this.spoken.push({ voice, settler });
  }

  /** Whether a notice keyed `key` may ring now. */
  admit(key: string, now: number): boolean {
    return this.gate.admit(key, now);
  }

  /** This frame's alert and notice one-shots, emptying the desk. */
  take(
    view: AlertView,
    snapshot: WorldSnapshot,
    index: SoundIndex,
    bindings: SoundBindings,
    now: number,
  ): OneShot[] {
    const shots: OneShot[] = [];
    if (this.attacks.length > 0) {
      const alerted = this.alerts.decide(this.attacks, view, now);
      this.attacks = [];
      const shot = alerted === null ? null : attackAlertShot(index, bindings, alerted.front);
      if (shot !== null) shots.push(shot);
    }
    for (const { voice, settler } of this.spoken) {
      const shot = noticeVoiceShot(index, bindings, snapshot, voice, settler);
      if (shot !== null && this.gate.admit(`voice:${voice}`, now)) shots.push(shot);
    }
    this.spoken = [];
    return shots;
  }
}
