import type { LocalBoardSnapshot } from '../localFirst/model';

export const ROAMING_PROTOCOL_VERSION = 'p2p-kanban-roaming/1' as const;
export const ROAMING_CAPABILITY_VERSION = 1 as const;

export interface RoamingCapability {
  formatVersion: typeof ROAMING_CAPABILITY_VERSION;
  protocolVersion: typeof ROAMING_PROTOCOL_VERSION;
  workspaceId: string;
  boardId: string;
  boardTag: string;
  boardKey: string;
  relays: string[];
  eventKind: number;
  minimumRelayAcks: number;
  provisionedAt: string;
}

export interface RoamingVersionStamp {
  logicalClock: number;
  replicaId: string;
  eventId: string;
}

export interface RoamingBoardEvent {
  protocolVersion: typeof ROAMING_PROTOCOL_VERSION;
  eventId: string;
  workspaceId: string;
  boardId: string;
  replicaId: string;
  replicaSeq: number;
  logicalClock: number;
  entityType: 'board' | 'card';
  entityId: string;
  operation: 'board.snapshot' | 'card.put' | 'card.delete';
  fieldMask: string[];
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface RoamingCiphertextRecord {
  version: 1;
  boardTag: string;
  nonce: string;
  ciphertext: string;
}

export interface RoamingApplyState {
  seenEventIds: string[];
  fieldVersions: Record<string, RoamingVersionStamp>;
  tombstones: Record<string, RoamingVersionStamp>;
  checklistTombstones: Record<string, RoamingVersionStamp>;
  checklistItemTombstones: Record<string, RoamingVersionStamp>;
  lastRelayPullAt: number;
}

export interface RoamingPullResult {
  snapshot: LocalBoardSnapshot | null;
  applyState: RoamingApplyState;
  received: number;
  applied: number;
  relayCount: number;
}

export interface RoamingPublishResult {
  eventId: string;
  acceptedRelays: string[];
  failedRelays: string[];
}
