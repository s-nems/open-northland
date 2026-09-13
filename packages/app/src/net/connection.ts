import { type OpenedWorld, RelayClient, RelaySocket, type WorldPort } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import { errorText } from '../diag/error-text.js';
import { diag } from '../diag/index.js';

export type ConnectionEvent =
  | { readonly kind: 'message'; readonly message: ServerMessage }
  | { readonly kind: 'link'; readonly state: 'ok' | 'reconnecting' | 'closed'; readonly reason?: string }
  | { readonly kind: 'failure'; readonly error: unknown };

export class NetworkConnection {
  readonly client: RelayClient;
  readonly socket: RelaySocket;
  private readonly listeners = new Set<(event: ConnectionEvent) => void>();
  private readonly port: Promise<WorldPort>;
  private resolvePort: (port: WorldPort) => void = () => undefined;
  private onWorld: (world: OpenedWorld) => void = () => undefined;
  private disposed = false;

  constructor(
    readonly url: string,
    identity: { token: string; nick: string },
  ) {
    this.port = new Promise((resolve) => {
      this.resolvePort = resolve;
    });
    this.client = new RelayClient({
      ...identity,
      world: {
        open: async (session, tick) => {
          const port = await this.port;
          return this.disposed ? null : port.open(session, tick);
        },
        restore: async (session, bytes) => {
          const port = await this.port;
          return this.disposed ? null : port.restore(session, bytes);
        },
      },
      connected: () => this.socket.connected,
      onMessage: (message) => this.emit({ kind: 'message', message }),
      onWorld: (world) => this.onWorld(world),
      onError: (what, error) => {
        diag.warn('net', `${what} failed`, { error: errorText(error) });
        // A world that could not be opened or a result that does not verify ends the game; a command
        // or snapshot dropped while the link is down is the link's notice to carry, not a failure.
        if (what === 'open' || what === 'restore' || what === 'result') this.emit({ kind: 'failure', error });
      },
    });
    this.socket = new RelaySocket({
      url,
      onOpen: () => {
        this.client.hello();
        this.emit({ kind: 'link', state: 'ok' });
      },
      onMessage: (raw) => {
        try {
          this.client.receive(raw);
        } catch (error) {
          this.emit({ kind: 'failure', error });
        }
      },
      onRetry: () => this.emit({ kind: 'link', state: 'reconnecting' }),
      onClosed: (reason) => this.emit({ kind: 'link', state: 'closed', reason }),
    });
    this.client.attach((message) => {
      this.socket.send(message);
    });
  }

  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  bindWorld(port: WorldPort, onWorld: (world: OpenedWorld) => void): void {
    if (this.disposed) return;
    this.onWorld = onWorld;
    this.resolvePort(port);
  }

  /** `leave` sends the explicit leave that gives a seat in a started game up; without it the link
   *  just closes and the relay keeps the seat for a reconnect. */
  dispose(leave = true): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    if (leave && this.client.room !== null && this.socket.connected) this.client.leaveRoom();
    this.client.receive({ kind: 'left' });
    this.onWorld = () => undefined;
    this.resolvePort({ open: async () => null, restore: async () => null });
    this.socket.close();
  }

  private emit(event: ConnectionEvent): void {
    if (!this.disposed) for (const listener of this.listeners) listener(event);
  }
}
