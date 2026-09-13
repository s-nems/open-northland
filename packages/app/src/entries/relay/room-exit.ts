import type { ServerMessage } from '@open-northland/net-protocol';

/** The relay ends a room with an error followed by left, while keeping the connection usable. */
export function roomExitObserver(
  onExit: (reason: string | null) => void,
): (message: ServerMessage) => boolean {
  let previousError: string | null = null;
  return (message) => {
    const reason = previousError;
    previousError = message.kind === 'error' ? message.reason : null;
    if (message.kind !== 'left') return false;
    onExit(reason);
    return true;
  };
}
