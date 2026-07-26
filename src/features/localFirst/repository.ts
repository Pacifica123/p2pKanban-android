import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionStorageKey } from '../../shared/storage/storage';
import {
  LOCAL_SCHEMA_VERSION,
  applyOperations,
  type LocalBoardSnapshot,
  type LocalOperation,
} from './model';

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
  return parse<LocalOperation[]>(raw, []).filter((operation) => Boolean(operation.id && operation.boardId));
}

export async function loadBoardSnapshot(boardId: string) {
  const raw = await AsyncStorage.getItem(sessionStorageKey(snapshotSuffix(boardId)));
  const snapshot = parse<LocalBoardSnapshot | null>(raw, null);
  return snapshot?.schemaVersion === LOCAL_SCHEMA_VERSION ? snapshot : null;
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
