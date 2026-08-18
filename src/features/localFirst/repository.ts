import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionStorageKey } from '../../shared/storage/storage';
import {
  LOCAL_SCHEMA_VERSION,
  applyOperations,
  type LocalBoardSnapshot,
  type LocalOperation,
} from './model';
import type { Card } from '../../shared/types/api';
import { defaultBoardAppearance } from '../appearance/boardTheme';

const QUEUE_SUFFIX = 'local-first/operations';

function snapshotSuffix(boardId: string) {
  return `local-first/board/${boardId}`;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadOperationQueue() {
  const raw = await AsyncStorage.getItem(sessionStorageKey(QUEUE_SUFFIX));
  return parse<Array<LocalOperation & { payload: Record<string, unknown> }>>(raw, [])
    .map(migrateOperation)
    .filter((operation): operation is LocalOperation => Boolean(operation?.id && operation.boardId));
}

function stripRemovedCardState(
  value: Card & { status?: unknown; completedAt?: unknown },
): Card {
  const { status: _status, completedAt: _completedAt, ...card } = value;
  return card;
}

function stripRemovedCardInput(value: Record<string, unknown>) {
  const { status: _status, completedAt: _completedAt, ...input } = value;
  return input;
}

function migrateOperation(
  operation: LocalOperation & { payload: Record<string, unknown> },
): LocalOperation | null {
  if (operation.kind === 'card.create') {
    const payload = operation.payload as unknown as {
      input: Record<string, unknown>;
      tempCard: Card & { status?: unknown; completedAt?: unknown };
    };
    return {
      ...operation,
      payload: {
        input: stripRemovedCardInput(payload.input),
        tempCard: stripRemovedCardState(payload.tempCard),
      },
    } as LocalOperation;
  }
  if (operation.kind === 'card.update') {
    const payload = operation.payload as unknown as { input: Record<string, unknown> };
    const input = stripRemovedCardInput(payload.input);
    if (!Object.keys(input).length) return null;
    return { ...operation, payload: { input } } as LocalOperation;
  }
  return operation as LocalOperation;
}

export async function loadBoardSnapshot(boardId: string) {
  const raw = await AsyncStorage.getItem(sessionStorageKey(snapshotSuffix(boardId)));
  const snapshot = parse<(Omit<
    LocalBoardSnapshot,
    'schemaVersion' | 'appearance' | 'checklistsByCardId' | 'checklistsHydratedAt'
  > & {
    schemaVersion: number;
    appearance?: LocalBoardSnapshot['appearance'];
    checklistsByCardId?: LocalBoardSnapshot['checklistsByCardId'];
    checklistsHydratedAt?: string | null;
  }) | null>(raw, null);
  if (!snapshot || !snapshot.board?.id) return null;
  if (![1, 2, 3, 4, LOCAL_SCHEMA_VERSION].includes(snapshot.schemaVersion)) return null;
  const migrated: LocalBoardSnapshot = {
    ...snapshot,
    schemaVersion: LOCAL_SCHEMA_VERSION,
    appearance: snapshot.appearance || defaultBoardAppearance(snapshot.board.id),
    cards: snapshot.cards.map((card) => stripRemovedCardState(
      card as Card & { status?: unknown; completedAt?: unknown },
    )),
    checklistsByCardId: snapshot.checklistsByCardId || {},
    checklistsHydratedAt: snapshot.checklistsHydratedAt || null,
  };
  return migrated;
}

export async function loadLocalBoardState(boardId: string) {
  const [snapshot, queue] = await Promise.all([
    loadBoardSnapshot(boardId),
    loadOperationQueue(),
  ]);
  return {
    snapshot,
    operations: queue.filter((operation) => operation.boardId === boardId),
  };
}

export async function persistBoardAndQueue(
  snapshot: LocalBoardSnapshot,
  operations: LocalOperation[],
) {
  await AsyncStorage.multiSet([
    [sessionStorageKey(snapshotSuffix(snapshot.board.id)), JSON.stringify(snapshot)],
    [sessionStorageKey(QUEUE_SUFFIX), JSON.stringify(operations)],
  ]);
}

export async function persistServerSnapshot(
  snapshot: LocalBoardSnapshot,
  allOperations: LocalOperation[],
) {
  const withPendingChanges = applyOperations(snapshot, allOperations);
  await persistBoardAndQueue(withPendingChanges, allOperations);
  return withPendingChanges;
}
