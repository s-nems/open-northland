import { formatMessage, localeTag, messages } from '../i18n/index.js';
import type { PipelineEvent } from '../ipc.js';
import { overallFraction } from '../progress-model.js';
import { el } from './dom.js';

/**
 * The run phase: the conversion's bar, stage line and log tail, driven by the pipeline events the
 * main process streams over. It owns the log tail because the failure copy replays it beneath the
 * error, and it ends the run by handing the page its terminal phase.
 */

const LOG_TAIL_LINES = 8;

export interface PipelineProgressView {
  /** Feed one conversion event; `done` and `error` are terminal and switch the phase. */
  handleEvent(event: PipelineEvent): void;
  /** A fresh run must not show the previous attempt's bar position or log tail. */
  reset(): void;
  /** Repaint the live stage line / failure headline in the active locale after a language switch. */
  relabel(): void;
}

export function createPipelineProgress(showPhase: (name: 'done' | 'failed') => void): PipelineProgressView {
  const barFill = el('bar-fill');
  const stageLabel = el('stage-label');
  const itemCount = el('item-count');
  const logTail = el('log-tail');
  const logLines: string[] = [];
  let currentStage: Extract<PipelineEvent, { kind: 'stage' }> | undefined;
  /** True once a run failed, so a language switch repaints the failure headline, not a stage line. */
  let errored = false;

  function pushLog(line: string): void {
    logLines.push(line);
    if (logLines.length > LOG_TAIL_LINES) logLines.shift();
    logTail.textContent = logLines.join('\n');
  }

  return {
    handleEvent(event: PipelineEvent): void {
      switch (event.kind) {
        case 'stage': {
          currentStage = event;
          stageLabel.textContent = `${messages().setup.stages[event.stage]}…`;
          itemCount.textContent = '';
          barFill.style.width = `${overallFraction({ stage: event.stage, done: 0, total: undefined }) * 100}%`;
          return;
        }
        case 'item': {
          if (currentStage === undefined) return;
          const fraction = overallFraction({
            stage: currentStage.stage,
            done: event.done,
            total: event.total,
          });
          const tag = localeTag();
          barFill.style.width = `${fraction * 100}%`;
          itemCount.textContent =
            event.total === undefined
              ? formatMessage(messages().setup.run.files, { done: event.done.toLocaleString(tag) })
              : `${event.done.toLocaleString(tag)} / ${event.total.toLocaleString(tag)}`;
          return;
        }
        case 'log': {
          pushLog(event.line);
          return;
        }
        case 'done': {
          barFill.style.width = '100%';
          showPhase('done');
          return;
        }
        case 'error': {
          errored = true;
          el('error-message').textContent = messages().setup.run.failed;
          el('error-log').textContent = [...logLines, event.message].join('\n');
          showPhase('failed');
          return;
        }
        default: {
          const exhaustive: never = event;
          throw new Error(`unhandled pipeline event ${JSON.stringify(exhaustive)}`);
        }
      }
    },

    reset(): void {
      logLines.length = 0;
      logTail.textContent = '';
      barFill.style.width = '0%';
      itemCount.textContent = '';
      currentStage = undefined;
      errored = false;
      stageLabel.textContent = messages().setup.run.starting;
    },

    relabel(): void {
      if (errored) {
        el('error-message').textContent = messages().setup.run.failed;
      } else if (currentStage !== undefined) {
        stageLabel.textContent = `${messages().setup.stages[currentStage.stage]}…`;
      }
    },
  };
}
