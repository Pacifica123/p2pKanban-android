import type {
  Board,
  BoardColumn,
  Card,
  Checklist,
  ChecklistItem,
} from '../../shared/types/api';

export const LOCAL_SCHEMA_VERSION = 2;

export interface LocalBoardSnapshot {
  schemaVersion: typeof LOCAL_SCHEMA_VERSION;
  workspaceId: string;
  board: Board;
  columns: BoardColumn[];
  cards: Card[];
  checklistsByCardId: Record<string, Checklist[]>;
  checklistsHydratedAt: string | null;
  cachedAt: string;
  lastServerRefreshAt: string | null;
}

interface OperationBase {
  id: string;
  boardId: string;
  entityId: string;
  status: 'pending' | 'failed';
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface CreateCardOperation extends OperationBase {
  kind: 'card.create';
  payload: {
    input: {
      title: string;
      description?: string;
      columnId: string;
      status?: Card['status'];
      priority?: Card['priority'];
    };
    tempCard: Card;
  };
}

export interface UpdateCardOperation extends OperationBase {
  kind: 'card.update';
  payload: {
    input: Partial<Pick<
      Card,
      'title' | 'description' | 'status' | 'priority' | 'startAt' | 'dueAt' | 'completedAt'
    >>;
  };
}

export interface MoveCardOperation extends OperationBase {
  kind: 'card.move';
  payload: {
    input: {
      targetColumnId: string;
      position?: number | null;
    };
  };
}

export interface ArchiveCardOperation extends OperationBase {
  kind: 'card.archive';
  payload: Record<string, never>;
}

export interface UpdateChecklistItemOperation extends OperationBase {
  kind: 'checklist.item.update';
  payload: {
    cardId: string;
    checklistId: string;
    input: {
      isDone: boolean;
    };
  };
}

export type LocalOperation =
  | CreateCardOperation
  | UpdateCardOperation
  | MoveCardOperation
  | ArchiveCardOperation
  | UpdateChecklistItemOperation;

function checklistCounts(checklists: Checklist[]) {
  const items = checklists.flatMap((checklist) => checklist.items);
  return {
    checklistCount: checklists.length,
    checklistItemCount: items.length,
    checklistCompletedItemCount: items.filter((item) => item.isDone).length,
  };
}

export function replaceChecklistItem(
  snapshot: LocalBoardSnapshot,
  cardId: string,
  item: ChecklistItem,
) {
  const checklists = (snapshot.checklistsByCardId[cardId] || []).map((checklist) => (
    checklist.id === item.checklistId
      ? {
        ...checklist,
        items: checklist.items.map((candidate) => candidate.id === item.id ? item : candidate),
        updatedAt: item.updatedAt,
      }
      : checklist
  ));
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => card.id === cardId
      ? { ...card, ...checklistCounts(checklists), updatedAt: item.updatedAt }
      : card),
    checklistsByCardId: {
      ...snapshot.checklistsByCardId,
      [cardId]: checklists,
    },
    cachedAt: item.updatedAt,
  };
}

function nextPosition(cards: Card[], columnId: string) {
  return cards
    .filter((card) => card.columnId === columnId && !card.isArchived)
    .reduce((highest, card) => Math.max(highest, card.position), 0) + 1000;
}

export function applyOperation(snapshot: LocalBoardSnapshot, operation: LocalOperation) {
  if (operation.kind === 'checklist.item.update') {
    const timestamp = operation.createdAt;
    const checklists = (snapshot.checklistsByCardId[operation.payload.cardId] || []).map(
      (checklist) => checklist.id === operation.payload.checklistId
        ? {
          ...checklist,
          updatedAt: timestamp,
          items: checklist.items.map((item) => item.id === operation.entityId
            ? {
              ...item,
              isDone: operation.payload.input.isDone,
              completedAt: operation.payload.input.isDone ? timestamp : null,
              updatedAt: timestamp,
            }
            : item),
        }
        : checklist,
    );
    return {
      ...snapshot,
      cards: snapshot.cards.map((card) => card.id === operation.payload.cardId
        ? { ...card, ...checklistCounts(checklists), updatedAt: timestamp }
        : card),
      checklistsByCardId: {
        ...snapshot.checklistsByCardId,
        [operation.payload.cardId]: checklists,
      },
      cachedAt: timestamp,
    };
  }

  if (operation.kind === 'card.create') {
    const exists = snapshot.cards.some((card) => card.id === operation.payload.tempCard.id);
    return {
      ...snapshot,
      cards: exists ? snapshot.cards : [...snapshot.cards, operation.payload.tempCard],
      cachedAt: operation.createdAt,
    };
  }

  if (operation.kind === 'card.update') {
    return {
      ...snapshot,
      cards: snapshot.cards.map((card) => card.id === operation.entityId
        ? { ...card, ...operation.payload.input, updatedAt: operation.createdAt }
        : card),
      cachedAt: operation.createdAt,
    };
  }

  if (operation.kind === 'card.move') {
    const position = operation.payload.input.position
      ?? nextPosition(snapshot.cards, operation.payload.input.targetColumnId);
    return {
      ...snapshot,
      cards: snapshot.cards.map((card) => card.id === operation.entityId
        ? {
          ...card,
          columnId: operation.payload.input.targetColumnId,
          position,
          updatedAt: operation.createdAt,
        }
        : card),
      cachedAt: operation.createdAt,
    };
  }

  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => card.id === operation.entityId
      ? {
        ...card,
        isArchived: true,
        archivedAt: operation.createdAt,
        updatedAt: operation.createdAt,
      }
      : card),
    cachedAt: operation.createdAt,
  };
}

export function applyOperations(snapshot: LocalBoardSnapshot, operations: LocalOperation[]) {
  return operations
    .filter((operation) => operation.boardId === snapshot.board.id)
    .reduce(applyOperation, snapshot);
}

export function replaceCreatedCard(
  snapshot: LocalBoardSnapshot,
  operations: LocalOperation[],
  tempId: string,
  serverCard: Card,
) {
  const nextSnapshot = {
    ...snapshot,
    cards: snapshot.cards.map((card) => card.id === tempId ? serverCard : card),
    cachedAt: new Date().toISOString(),
  };
  const nextOperations = operations.map((operation) => operation.entityId === tempId
    ? { ...operation, entityId: serverCard.id }
    : operation);

  return { snapshot: nextSnapshot, operations: nextOperations };
}

export function createTemporaryCard(input: {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  status?: Card['status'];
  priority?: Card['priority'];
  cards: Card[];
  now: string;
}): Card {
  return {
    id: input.id,
    boardId: input.boardId,
    columnId: input.columnId,
    parentCardId: null,
    title: input.title,
    description: input.description || null,
    status: input.status ?? null,
    priority: input.priority ?? null,
    position: nextPosition(input.cards, input.columnId),
    startAt: null,
    dueAt: null,
    completedAt: null,
    isArchived: false,
    labelIds: [],
    checklistCount: 0,
    checklistItemCount: 0,
    checklistCompletedItemCount: 0,
    commentCount: 0,
    createdByUserId: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
  };
}

export function isTemporaryCardId(id: string) {
  return id.startsWith('local-card-');
}
