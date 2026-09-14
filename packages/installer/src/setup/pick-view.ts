import type { ContentStatus } from '../content-state.js';
import { formatMessage, messages } from '../i18n/index.js';

export interface PickState {
  /** The mod root the conversion will read: downloaded into the data root, or hand-picked. */
  readonly modRoot: string | undefined;
  readonly contentStatus: ContentStatus;
}

export interface StatusNote {
  readonly text: string;
  /** A schema mismatch, which no button in this phase can play through. */
  readonly blocking: boolean;
}

export interface PickView {
  /** Which mod copy the conversion will read; empty while none is known and the mod panel shows. */
  readonly modNote: string;
  readonly modPanelVisible: boolean;
  readonly installDisabled: boolean;
  readonly installLabel: string;
  readonly statusNote: StatusNote | undefined;
  /** Undefined hides the button: nothing installed yet, or content that must not boot. */
  readonly playNowLabel: string | undefined;
}

type ContentControls = Pick<PickView, 'installLabel' | 'statusNote' | 'playNowLabel'>;

function contentControlsOf(status: ContentStatus): ContentControls {
  const t = messages().setup;
  switch (status) {
    case 'missing':
      return { installLabel: t.install, statusNote: undefined, playNowLabel: undefined };
    case 'ready':
      return {
        installLabel: t.regenerate,
        statusNote: { text: t.status.ready, blocking: false },
        playNowLabel: t.play,
      };
    case 'stale-revision':
      return {
        installLabel: t.regenerate,
        statusNote: { text: t.status.staleRevision, blocking: false },
        playNowLabel: t.playAnyway,
      };
    case 'stale-schema':
      return {
        installLabel: t.regenerate,
        statusNote: { text: t.status.staleSchema, blocking: true },
        playNowLabel: undefined,
      };
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled content status ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function pickView({ modRoot, contentStatus }: PickState): PickView {
  return {
    modNote: modRoot === undefined ? '' : formatMessage(messages().setup.mod.using, { path: modRoot }),
    modPanelVisible: modRoot === undefined,
    installDisabled: modRoot === undefined,
    ...contentControlsOf(contentStatus),
  };
}
