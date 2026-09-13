import { type LobbyCompatibility, PROTOCOL_VERSION } from '@open-northland/net-protocol';

/** Shared synthetic content and map used by the relay's fixture clients. */
export const TEST_COMPATIBILITY: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'fixture-client',
  protocol: PROTOCOL_VERSION,
};
