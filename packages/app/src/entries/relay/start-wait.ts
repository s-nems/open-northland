import type { RelayClientView } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import {
  mountStartRoster,
  type StartRoster,
  type StartRosterRow,
  startRosterRows,
} from '../../view/net/start-roster.js';

type StartClient = Pick<RelayClientView, 'nick' | 'room' | 'clockState' | 'waitingFor'>;

export interface StartWait {
  /** Every relay message, after the client applied it. */
  observe(message: ServerMessage): void;
  /** This client's own boot progress in whole percent. */
  progress(percent: number): void;
  /** Settles once the room starts, or at once while `current` says the waiting world was replaced. */
  untilStart(current: () => boolean): Promise<void>;
  /** A newer world or a closed game: every pending wait settles, the roster stays. */
  release(): void;
  /** The wait is over for good: the roster goes and every pending wait settles. */
  end(): void;
}

/** A relayed start: the loading card stays up until the room's clock runs and nobody still loads, with
 *  the players plaque showing how far each one is. */
export function createStartWait(client: StartClient): StartWait {
  let roster: StartRoster | null = mountStartRoster();
  let waits: (() => void)[] = [];
  let ownProgress: number | null = null;
  let heardWaiting = client.waitingFor.length > 0;
  const dropped: Pick<StartRosterRow, 'nick' | 'color'>[] = [];
  let shown: readonly StartRosterRow[] = [];

  const started = (): boolean =>
    client.clockState !== null && !client.waitingFor.some((member) => member.reason === 'loading');
  const render = (): void => {
    if (roster === null) return;
    shown = startRosterRows({
      room: client.room,
      waitingFor: client.waitingFor,
      heardWaiting,
      ownNick: client.nick,
      ownProgress,
      dropped,
    });
    roster.update(shown);
  };
  const release = (): void => {
    const pending = waits;
    waits = [];
    for (const wait of pending) wait();
  };
  const end = (): void => {
    roster?.dispose();
    roster = null;
    release();
  };
  render();

  return {
    observe(message): void {
      if (message.kind === 'waiting') heardWaiting = true;
      if (message.kind === 'kicked' && message.cause === 'loading') {
        const color = shown.find((row) => row.nick === message.nick)?.color ?? 'transparent';
        dropped.push({ nick: message.nick, color });
      }
      if (started()) end();
      else render();
    },
    progress(percent): void {
      ownProgress = percent;
      render();
    },
    untilStart(current): Promise<void> {
      if (!current()) return Promise.resolve();
      if (started()) {
        end();
        return Promise.resolve();
      }
      return new Promise((resolve) => waits.push(resolve));
    },
    release,
    end,
  };
}
