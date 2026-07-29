import type { Card } from '../../shared/types/api';
import { LOCAL_SCHEMA_VERSION, type LocalBoardSnapshot } from '../localFirst/model';
import { applyRoamingEvents, EMPTY_ROAMING_APPLY_STATE } from './merge';
import { ROAMING_PROTOCOL_VERSION, type RoamingBoardEvent } from './types';

const workspaceId = '018f22e2-355a-7ba2-8ef0-d7bc788ceec8';
const boardId = '018f22e2-355a-7ba2-8ef0-d7bc788ceec9';
const cardId = '018f22e2-355a-7ba2-8ef0-d7bc788ceeca';

function card(title: string): Card {
  return {
    id: cardId,
    boardId,
    columnId: '018f22e2-355a-7ba2-8ef0-d7bc788ceecb',
    title,
    status: 'active',
    priority: null,
    position: 1000,
    isArchived: false,
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z',
  };
}

function snapshot(): LocalBoardSnapshot {
  return {
    schemaVersion: LOCAL_SCHEMA_VERSION,
    workspaceId,
    board: {
      id: boardId,
      workspaceId,
      name: 'Доска',
      boardType: 'kanban',
      isArchived: false,
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    columns: [],
    cards: [card('исходная')],
    checklistsByCardId: {},
    checklistsHydratedAt: '2026-07-28T10:00:00.000Z',
    cachedAt: '2026-07-28T10:00:00.000Z',
    lastServerRefreshAt: null,
  };
}

function event(logicalClock: number, replicaId: string, title: string): RoamingBoardEvent {
  return {
    protocolVersion: ROAMING_PROTOCOL_VERSION,
    eventId: `018f22e2-1d58-7f08-9a36-${replicaId.endsWith('b') ? '1' : '0'}${String(logicalClock).padStart(11, '0')}`,
    workspaceId,
    boardId,
    replicaId,
    replicaSeq: logicalClock,
    logicalClock,
    entityType: 'card',
    entityId: cardId,
    operation: 'card.put',
    fieldMask: ['title'],
    payload: { card: card(title) },
    occurredAt: '2026-07-28T12:00:00.000Z',
  };
}

test('later logical clock wins regardless of delivery order', () => {
  const result = applyRoamingEvents(snapshot(), EMPTY_ROAMING_APPLY_STATE, [
    event(9, 'replica-a', 'новее'),
    event(8, 'replica-z', 'старее'),
  ]);
  expect(result.snapshot?.cards[0]?.title).toBe('новее');
});

test('replica id deterministically resolves parallel events', () => {
  const result = applyRoamingEvents(snapshot(), EMPTY_ROAMING_APPLY_STATE, [
    event(9, 'replica-a', 'A'),
    event(9, 'replica-b', 'B'),
  ]);
  expect(result.snapshot?.cards[0]?.title).toBe('B');
});

test('roaming card bundle carries checklist items', () => {
  const checklistEvent = event(10, 'replica-a', 'исходная');
  checklistEvent.fieldMask = ['checklists'];
  checklistEvent.payload = {
    card: card('исходная'),
    checklists: [{
      id: '018f22e2-355a-7ba2-8ef0-d7bc788ceecd',
      cardId,
      title: 'Релиз',
      position: 1000,
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T12:00:00.000Z',
      items: [{
        id: '018f22e2-355a-7ba2-8ef0-d7bc788ceece',
        checklistId: '018f22e2-355a-7ba2-8ef0-d7bc788ceecd',
        title: 'Проверить APK',
        isDone: true,
        position: 1000,
        completedAt: '2026-07-28T12:00:00.000Z',
        createdAt: '2026-07-28T10:00:00.000Z',
        updatedAt: '2026-07-28T12:00:00.000Z',
      }],
    }],
  };

  const result = applyRoamingEvents(
    snapshot(),
    EMPTY_ROAMING_APPLY_STATE,
    [checklistEvent],
  );
  expect(result.snapshot?.checklistsByCardId[cardId]?.[0]?.items[0]?.isDone).toBe(true);
});
