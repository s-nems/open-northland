import { formatMessage, localeTag, messages } from '../i18n/index.js';
import { overallFraction } from '../progress-model.js';
import type { PipelineEvent } from '../shell-api.js';
import { el } from './dom.js';

const LOG_TAIL_LINES = 8;

export interface PipelineProgressView {
  /** `done` and `error` are terminal: both switch the page's phase. */
  handleEvent(event: PipelineEvent): void;
  reset(): void;
  /** Repaint the stage line or failure headline after a language switch. */
  relabel(): void;
}

export function createPipelineProgress(showPhase: (name: 'done' | 'failed') => void): PipelineProgressView {
  const barFill = el('bar-fill');
  const stageLabel = el('stage-label');
  const itemCount = el('item-count');
  const logTail = el('log-tail');
  const logLines: string[] = [];
  let currentStage: Extract<PipelineEvent, { kind: 'stage' }> | undefined;
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
