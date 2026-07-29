import type { Board, BoardColumn, Card } from '../../shared/types/api';
import {
  LOCAL_SCHEMA_VERSION,
  applyOperations,
  createTemporaryCard,
  replaceCreatedCard,
  type LocalBoardSnapshot,
  type LocalOperation,
} from './model';

const board: Board = {
  id: 'board-1',
  workspaceId: 'workspace-1',
  name: 'Mobile',
  boardType: 'kanban',
  isArchived: false,
  createdAt: '2026-07-26T10:00:00Z',
  updatedAt: '2026-07-26T10:00:00Z',
};

const columnA: BoardColumn = {
  id: 'column-a',
  boardId: board.id,
  name: 'План',
  position: 1000,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
};

const columnB: BoardColumn = {
  ...columnA,
  id: 'column-b',
  name: 'Готово',
  position: 2000,
};

function snapshot(cards: Card[] = []): LocalBoardSnapshot {
  return {
    schemaVersion: LOCAL_SCHEMA_VERSION,
    workspaceId: board.workspaceId,
    board,
    columns: [columnA, columnB],
    cards,
    checklistsByCardId: {},
    checklistsHydratedAt: board.updatedAt,
    cachedAt: board.updatedAt,
    lastServerRefreshAt: board.updatedAt,
  };
}

describe('local-first reducer', () => {
  it('replays create, update and move in their original order', () => {
    const temp = createTemporaryCard({
      id: 'local-card-one',
      boardId: board.id,
      columnId: columnA.id,
      title: 'Первый APK',
      cards: [],
      now: '2026-07-26T10:01:00Z',
    });
    const operations: LocalOperation[] = [
      {
        id: 'op-1',
        boardId: board.id,
        entityId: temp.id,
        kind: 'card.create',
        status: 'pending',
        createdAt: temp.createdAt,
        attempts: 0,
        lastError: null,
        payload: {
          input: { title: temp.title, columnId: columnA.id },
          tempCard: temp,
        },
      },
      {
        id: 'op-2',
        boardId: board.id,
        entityId: temp.id,
        kind: 'card.update',
        status: 'pending',
        createdAt: '2026-07-26T10:02:00Z',
        attempts: 0,
        lastError: null,
        payload: { input: { priority: 'high' } },
      },
      {
        id: 'op-3',
        boardId: board.id,
        entityId: temp.id,
        kind: 'card.move',
        status: 'pending',
        createdAt: '2026-07-26T10:03:00Z',
        attempts: 0,
        lastError: null,
        payload: { input: { targetColumnId: columnB.id } },
      },
    ];

    const result = applyOperations(snapshot(), operations);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      id: temp.id,
      priority: 'high',
      columnId: columnB.id,
    });
  });

  it('rewrites later operations after a temporary card receives a server id', () => {
    const temp = createTemporaryCard({
      id: 'local-card-one',
      boardId: board.id,
      columnId: columnA.id,
      title: 'Первый APK',
      cards: [],
      now: '2026-07-26T10:01:00Z',
    });
    const serverCard: Card = { ...temp, id: 'server-card-1' };
    const operations: LocalOperation[] = [
      {
        id: 'op-1',
        boardId: board.id,
        entityId: temp.id,
        kind: 'card.create',
        status: 'pending',
        createdAt: temp.createdAt,
        attempts: 0,
        lastError: null,
        payload: {
          input: { title: temp.title, columnId: columnA.id },
          tempCard: temp,
        },
      },
      {
        id: 'op-2',
        boardId: board.id,
        entityId: temp.id,
        kind: 'card.update',
        status: 'pending',
        createdAt: temp.createdAt,
        attempts: 0,
        lastError: null,
        payload: { input: { title: 'После создания' } },
      },
    ];

    const result = replaceCreatedCard(snapshot([temp]), operations, temp.id, serverCard);
    expect(result.snapshot.cards[0]?.id).toBe(serverCard.id);
    expect(result.operations.every((operation) => operation.entityId === serverCard.id)).toBe(true);
  });

  it('toggles a checklist item in the local snapshot', () => {
    const localCard = createTemporaryCard({
      id: 'card-with-checklist',
      boardId: board.id,
      columnId: columnA.id,
      title: 'Карточка с чек-листом',
      cards: [],
      now: board.updatedAt,
    });
    const initial = snapshot([localCard]);
    initial.checklistsByCardId[localCard.id] = [{
      id: 'checklist-1',
      cardId: localCard.id,
      title: 'Проверки',
      position: 1000,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      items: [{
        id: 'item-1',
        checklistId: 'checklist-1',
        title: 'Собрать APK',
        isDone: false,
        position: 1000,
        completedAt: null,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      }],
    }];
    const operation: LocalOperation = {
      id: 'op-checklist-1',
      boardId: board.id,
      entityId: 'item-1',
      kind: 'checklist.item.update',
      status: 'pending',
      createdAt: '2026-07-26T10:04:00Z',
      attempts: 0,
      lastError: null,
      payload: {
        cardId: localCard.id,
        checklistId: 'checklist-1',
        input: { isDone: true },
      },
    };

    const result = applyOperations(initial, [operation]);
    expect(result.checklistsByCardId[localCard.id]?.[0]?.items[0]?.isDone).toBe(true);
    expect(result.cards[0]).toMatchObject({
      checklistCount: 1,
      checklistItemCount: 1,
      checklistCompletedItemCount: 1,
    });
  });
});
