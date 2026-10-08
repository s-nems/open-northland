import { type LaneCounts, type SoundStatsView, STAT_LANES, zeroLanes } from '@open-northland/audio';
import type { Command, PlayerCommand } from '@open-northland/sim';
import { diag } from '../diag/index.js';
import { formatMessage, sceneStageLabels } from '../i18n/index.js';
import type { SceneStage, StageAction } from '../scenes/types.js';
import type { SessionHost } from '../session/index.js';
import { type CameraController, cameraCenteredOnTile } from './camera/index.js';
import { BUTTON_STYLE, el } from './overlay.js';

/**
 * A scene's stage bar: one button per stage jumps the camera there, and the stage's own buttons issue
 * its orders or set its zoom. While a stage is open the bar logs, once a second on the `audio` channel,
 * what the sound driver was offered and started per lane in that second, its busiest frame, and the
 * world shots stolen, so a listener can read the numbers behind what they hear.
 */

/** How often the bar logs the driver's counts. */
const REPORT_INTERVAL_MS = 1000;

const BAR_STYLE = [
  'position:fixed',
  'top:64px',
  'left:50%',
  'transform:translateX(-50%)',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'gap:4px',
  'padding:6px 8px',
  'background:rgba(20,16,12,0.85)',
  'border:1px solid #5a4a36',
  'border-radius:6px',
  'z-index:60',
].join(';');
const ROW_STYLE = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:center';
const ACTIVE_BUTTON_STYLE = `${BUTTON_STYLE};background:#6b5840;font-weight:700`;

export interface SceneStagesDeps {
  readonly sceneId: string;
  readonly stages: readonly SceneStage[];
  readonly host: Pick<SessionHost, 'snapshot'>;
  readonly cameraCtl: Pick<CameraController, 'jumpTo'>;
  readonly viewport: () => { readonly width: number; readonly height: number };
  /** The viewing seat's order path, answer and all. */
  readonly issue: (command: PlayerCommand) => void;
  /** Trusted input, for the other seats' orders and the debug completions. */
  readonly submitAdmin: (command: Command) => void;
  /** The sound driver's running counts; null while the session plays no sound. */
  readonly soundStats: () => SoundStatsView | null;
  readonly signal: AbortSignal;
}

/** Per-lane totals over the report interval and the busiest frame in it. */
interface CountWindow {
  frames: number;
  readonly offered: LaneCounts;
  readonly started: LaneCounts;
  stolen: number;
  peakOffered: number;
  peakStarted: number;
}

function emptyWindow(): CountWindow {
  return { frames: 0, offered: zeroLanes(), started: zeroLanes(), stolen: 0, peakOffered: 0, peakStarted: 0 };
}

/** Reads the driver's totals each frame into a window, without allocating. */
class StatsWindow {
  private readonly last = emptyWindow();
  private readonly current = emptyWindow();
  private primed = false;

  sample(stats: SoundStatsView): void {
    let offered = 0;
    let started = 0;
    for (const lane of STAT_LANES) {
      const o = stats.offered[lane] - this.last.offered[lane];
      const s = stats.started[lane] - this.last.started[lane];
      this.last.offered[lane] = stats.offered[lane];
      this.last.started[lane] = stats.started[lane];
      if (!this.primed) continue;
      this.current.offered[lane] = this.current.offered[lane] + o;
      this.current.started[lane] = this.current.started[lane] + s;
      offered += o;
      started += s;
    }
    const frames = stats.frames - this.last.frames;
    const stolen = stats.stolen - this.last.stolen;
    this.last.frames = stats.frames;
    this.last.stolen = stats.stolen;
    if (!this.primed) {
      this.primed = true;
      return;
    }
    this.current.frames += frames;
    this.current.stolen += stolen;
    this.current.peakOffered = Math.max(this.current.peakOffered, offered);
    this.current.peakStarted = Math.max(this.current.peakStarted, started);
  }

  /** The window as a log record, then cleared. */
  take(): Record<string, unknown> {
    const w = this.current;
    const lanes: Record<string, string> = {};
    for (const lane of STAT_LANES) {
      const offered = w.offered[lane];
      const started = w.started[lane];
      if (offered > 0) lanes[lane] = `${started} of ${offered} started, ${offered - started} dropped`;
      w.offered[lane] = 0;
      w.started[lane] = 0;
    }
    const record = {
      frames: w.frames,
      lanes,
      stolen: w.stolen,
      busiestFrame: { offered: w.peakOffered, started: w.peakStarted },
    };
    w.frames = 0;
    w.stolen = 0;
    w.peakOffered = 0;
    w.peakStarted = 0;
    return record;
  }
}

export function mountSceneStages(deps: SceneStagesDeps): void {
  const labels = sceneStageLabels(deps.sceneId) ?? {};
  const label = (key: string, values?: Readonly<Record<string, number>>): string => {
    const text = labels[key] ?? key;
    return values === undefined ? text : formatMessage(text, values);
  };
  const bar = el('div', BAR_STYLE);
  const stageRow = el('div', ROW_STYLE);
  const actionRow = el('div', ROW_STYLE);
  // A probe finds the bar by this mark.
  bar.dataset.sceneStages = '';
  bar.append(stageRow, actionRow);
  document.body.append(bar);
  deps.signal.addEventListener('abort', () => bar.remove(), { once: true });

  let active: SceneStage | null = null;
  const counts = new StatsWindow();
  let reportedAt = performance.now();

  const frame = (now: number): void => {
    if (deps.signal.aborted) return;
    const stats = deps.soundStats();
    if (stats !== null && active !== null) {
      counts.sample(stats);
      if (now - reportedAt >= REPORT_INTERVAL_MS) {
        reportedAt = now;
        diag.info('audio', `stage ${active.id}`, counts.take());
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const jump = (stage: SceneStage, zoom: number): void => {
    const { width, height } = deps.viewport();
    deps.cameraCtl.jumpTo(cameraCenteredOnTile(stage.focus.x, stage.focus.y, zoom, width, height));
  };
  const run = (stage: SceneStage, action: StageAction): void => {
    if (action.kind === 'zoom') {
      jump(stage, action.zoom);
      return;
    }
    for (const order of action.orders(deps.host.snapshot())) {
      if (order.by === 'viewer') deps.issue(order.command);
      else deps.submitAdmin(order.command);
    }
  };
  const stageButtons = new Map<SceneStage, HTMLButtonElement>();
  const open = (stage: SceneStage): void => {
    active = stage;
    for (const [s, b] of stageButtons) b.style.cssText = s === stage ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE;
    actionRow.replaceChildren(
      ...stage.actions.map((action) => {
        const b = el('button', BUTTON_STYLE, label(action.label, action.values));
        b.addEventListener('click', () => run(stage, action));
        return b;
      }),
    );
    jump(stage, stage.zoom);
  };
  for (const stage of deps.stages) {
    const b = el('button', BUTTON_STYLE, label(stage.id));
    b.addEventListener('click', () => open(stage));
    stageButtons.set(stage, b);
    stageRow.append(b);
  }
}
