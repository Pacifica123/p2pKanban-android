import * as Crypto from 'expo-crypto';
import { getPublicKey, generateSecretKey } from 'nostr-tools/pure';

import type { Card } from '../../shared/types/api';
import type { LocalBoardSnapshot, LocalOperation } from '../localFirst/model';
import {
  decodeBoardKey,
  deriveBoardTag,
  openRoamingEvent,
  sealRoamingEvent,
} from './codec';
import { applyRoamingEvents } from './merge';
import {
  createSignedNostrEvent,
  fetchFromRelays,
  publishToRelays,
} from './nostrRelay';
import {
  getOrCreateRoamingDeviceSecret,
  loadRoamingApplyState,
  loadRoamingCapability,
  saveRoamingApplyState,
  saveRoamingCapability,
} from './storage';
import {
  ROAMING_CAPABILITY_VERSION,
  ROAMING_PROTOCOL_VERSION,
  type RoamingBoardEvent,
  type RoamingCapability,
  type RoamingPublishResult,
  type RoamingPullResult,
} from './types';

function validateCapability(capability: RoamingCapability) {
  if (
    capability.formatVersion !== ROAMING_CAPABILITY_VERSION
    || capability.protocolVersion !== ROAMING_PROTOCOL_VERSION
  ) {
    throw new Error('Узел вернул несовместимый формат независимой доски.');
  }
  const key = decodeBoardKey(capability.boardKey);
  if (deriveBoardTag(key, capability.boardId) !== capability.boardTag) {
    throw new Error('Ключ доски не соответствует её анонимному тегу.');
  }
  if (capability.relays.length < 2) {
    throw new Error('Для независимой доски нужны хотя бы два релея.');
  }
  return key;
}

async function identity() {
  const secretKey = await getOrCreateRoamingDeviceSecret(() => generateSecretKey());
  const publicKey = getPublicKey(secretKey);
  const replicaId = [
    publicKey.slice(0, 8),
    publicKey.slice(8, 12),
    `4${publicKey.slice(13, 16)}`,
    `a${publicKey.slice(17, 20)}`,
    publicKey.slice(20, 32),
  ].join('-');
  return { secretKey, replicaId };
}

function fieldsFor(operation: LocalOperation) {
  if (operation.kind === 'checklist.item.update') return ['checklists'];
  if (operation.kind === 'card.create') return ['*'];
  if (operation.kind === 'card.update') return Object.keys(operation.payload.input);
  if (operation.kind === 'card.move') return ['columnId', 'position', 'updatedAt'];
  return ['isArchived', 'archivedAt', 'updatedAt'];
}

function eventForCard(input: {
  capability: RoamingCapability;
  operation: LocalOperation;
  card: Card;
  checklists: LocalBoardSnapshot['checklistsByCardId'][string];
  replicaId: string;
  replicaSeq: number;
  logicalClock: number;
}): RoamingBoardEvent {
  return {
    protocolVersion: ROAMING_PROTOCOL_VERSION,
    eventId: input.operation.id,
    workspaceId: input.capability.workspaceId,
    boardId: input.capability.boardId,
    replicaId: input.replicaId,
    replicaSeq: input.replicaSeq,
    logicalClock: input.logicalClock,
    entityType: 'card',
    entityId: input.card.id,
    operation: 'card.put',
    fieldMask: fieldsFor(input.operation),
    payload: {
      card: input.card,
      checklists: input.checklists,
    },
    occurredAt: input.operation.createdAt,
  };
}

function operationSequence(operation: LocalOperation) {
  const milliseconds = Math.max(Date.parse(operation.createdAt), 1);
  const suffix = Number.parseInt(operation.id.replace(/-/g, '').slice(-3), 16) || 0;
  return (milliseconds * 1000) + suffix;
}

async function publishEvent(
  capability: RoamingCapability,
  event: RoamingBoardEvent,
): Promise<RoamingPublishResult> {
  const boardKey = validateCapability(capability);
  const { secretKey } = await identity();
  const content = sealRoamingEvent(
    event,
    boardKey,
    capability.boardTag,
    Crypto.getRandomBytes(24),
  );
  const nostr = createSignedNostrEvent({
    secretKey,
    kind: capability.eventKind,
    boardTag: capability.boardTag,
    content,
  });
  const result = await publishToRelays(
    capability.relays,
    nostr,
    capability.minimumRelayAcks,
  );
  return { eventId: event.eventId, ...result };
}

export async function installRoamingCapability(capability: RoamingCapability) {
  validateCapability(capability);
  await saveRoamingCapability(capability);
  return capability;
}

export async function publishBoardSnapshot(
  capability: RoamingCapability,
  snapshot: LocalBoardSnapshot,
) {
  const { replicaId } = await identity();
  const timestamp = Date.now();
  return publishEvent(capability, {
    protocolVersion: ROAMING_PROTOCOL_VERSION,
    eventId: Crypto.randomUUID(),
    workspaceId: capability.workspaceId,
    boardId: capability.boardId,
    replicaId,
    replicaSeq: timestamp,
    logicalClock: timestamp,
    entityType: 'board',
    entityId: capability.boardId,
    operation: 'board.snapshot',
    fieldMask: ['*'],
    payload: { snapshot },
    occurredAt: new Date(timestamp).toISOString(),
  });
}

export async function publishLocalOperation(
  capability: RoamingCapability,
  operation: LocalOperation,
  snapshot: LocalBoardSnapshot,
) {
  const cardId = operation.kind === 'checklist.item.update'
    ? operation.payload.cardId
    : operation.entityId;
  const card = snapshot.cards.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error('Локальная карточка для события не найдена.');
  const { replicaId } = await identity();
  const logicalClock = operationSequence(operation);
  return publishEvent(capability, eventForCard({
    capability,
    operation,
    card,
    checklists: snapshot.checklistsByCardId[card.id] || [],
    replicaId,
    replicaSeq: logicalClock,
    logicalClock,
  }));
}

export async function pullRoamingBoard(
  capability: RoamingCapability,
  currentSnapshot: LocalBoardSnapshot | null,
): Promise<RoamingPullResult> {
  const boardKey = validateCapability(capability);
  const applyState = await loadRoamingApplyState(capability.boardId);
  const response = await fetchFromRelays({
    relays: capability.relays,
    kind: capability.eventKind,
    boardTag: capability.boardTag,
  });
  const events = response.events.flatMap((nostr) => {
    try {
      const event = openRoamingEvent(nostr.content, boardKey, capability.boardTag);
      if (
        event.workspaceId !== capability.workspaceId
        || event.boardId !== capability.boardId
      ) return [];
      return [event];
    } catch {
      return [];
    }
  });
  const merged = applyRoamingEvents(currentSnapshot, applyState, events);
  const nextState = {
    ...merged.state,
    lastRelayPullAt: Math.floor(Date.now() / 1000),
  };
  await saveRoamingApplyState(capability.boardId, nextState);
  return {
    snapshot: merged.snapshot,
    applyState: nextState,
    received: events.length,
    applied: merged.applied,
    relayCount: response.relayCount,
  };
}

export { loadRoamingCapability };
