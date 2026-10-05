import { type ChatLine, MAX_CHAT_HISTORY_LINES, type ServerMessage } from '@open-northland/net-protocol';

/** A room's chat, oldest first, at most `MAX_CHAT_HISTORY_LINES`; it ends with the room. */
export class ChatLog {
  private readonly lines: ChatLine[] = [];

  /** Keep `line`, dropping the oldest past the cap, and return the broadcast that carries it. */
  add(line: ChatLine): Extract<ServerMessage, { kind: 'chat' }> {
    this.lines.push(line);
    if (this.lines.length > MAX_CHAT_HISTORY_LINES) this.lines.shift();
    return { kind: 'chat', ...line };
  }

  /** The log so far, for a member entering or returning to the room. */
  history(): Extract<ServerMessage, { kind: 'chatHistory' }> {
    return { kind: 'chatHistory', lines: [...this.lines] };
  }
}
