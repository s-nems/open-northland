import type { InitialSaveIdentity } from '@open-northland/lockstep';
import type { VerifiedMapDocuments } from '../content/transfer/index.js';
import type { NetworkConnection } from './connection.js';

export interface NetworkHandover {
  readonly connection: NetworkConnection;
  readonly map: VerifiedMapDocuments;
  readonly initialSave: { readonly identity: InitialSaveIdentity; readonly bytes: string } | null;
}

let pending: NetworkHandover | null = null;

export function stageNetworkHandover(handover: NetworkHandover): void {
  if (pending !== null) throw new Error('A network game is already starting');
  pending = handover;
}

export function takeNetworkHandover(): NetworkHandover | null {
  const result = pending;
  pending = null;
  return result;
}
