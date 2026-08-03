import type { ContentStatus } from '../content-state.js';
import { formatMessage, messages } from '../i18n/index.js';

/** Kept as findings rather than a rendered note, so a language switch can re-word it. */
export type Probe =
  | { readonly kind: 'idle' }
  | { readonly kind: 'no-archives' }
  | { readonly kind: 'valid'; readonly path: string; readonly hasMod: boolean };

export interface PickState {
  readonly probe: Probe;
  /** A mod root outside the game folder (downloaded into the data root, or hand-picked). */
  readonly externalModRoot: string | undefined;
  readonly contentStatus: ContentStatus;
}

export interface StatusNote {
  readonly text: string;
  /** A schema mismatch, which no button in this phase can play through. */
  readonly blocking: boolean;
}

export interface PickView {
  readonly probeNote: string;
  readonly modPanelVisible: boolean;
  readonly installDisabled: boolean;
  readonly installLabel: string;
  readonly statusNote: StatusNote | undefined;
  /** Undefined hides the button: nothing installed yet, or content that must not boot. */
  readonly playNowLabel: string | undefined;
}

function probeNoteOf(probe: Probe, externalModRoot: string | undefined): string {
  const t = messages().setup;
  switch (probe.kind) {
    case 'idle':
      return '';
    case 'no-archives':
      return t.probe.noArchives;
    case 'valid':
      if (probe.hasMod) return t.probe.withMod;
      return externalModRoot === undefined
        ? t.probe.noMod
        : formatMessage(t.probe.externalMod, { path: externalModRoot });
    default: {
      const exhaustive: never = probe;
      throw new Error(`unhandled probe state ${JSON.stringify(exhaustive)}`);
    }
  }
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

export function pickView({ probe, externalModRoot, contentStatus }: PickState): PickView {
  const modReady = probe.kind === 'valid' && (probe.hasMod || externalModRoot !== undefined);
  return {
    probeNote: probeNoteOf(probe, externalModRoot),
    modPanelVisible: probe.kind === 'valid' && !modReady,
    installDisabled: !modReady,
    ...contentControlsOf(contentStatus),
  };
}
