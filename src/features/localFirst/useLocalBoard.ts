import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNetwork } from '../../app/NetworkProvider';
import { ApiError, isNetworkError } from '../../shared/api/client';
import {
  archiveCard,
  createCard,
  moveCard,
  provisionRoamingBoard,
  updateCard,
  updateChecklistItem,
} from '../../shared/api/endpoints';
import type { Card, Checklist } from '../../shared/types/api';
import {
  installRoamingCapability,
  loadRoamingCapability,
  publishBoardSnapshot,
  publishLocalOperation,
  pullRoamingBoard,
} from '../roaming/service';
import type { RoamingCapability } from '../roaming/types';
import { touchWorkspaceSync } from '../sync/syncService';
import {
  applyOperation,
  createTemporaryCard,
  isTemporaryCardId,
  replaceChecklistItem,
  replaceCreatedCard,
  type LocalBoardSnapshot,
  type LocalOperation,
} from './model';
import {
  loadLocalBoardState,
  loadOperationQueue,
  persistBoardAndQueue,
  persistServerSnapshot,
} from './repository';
import { fetchBoardSnapshot } from './snapshot';

export interface LocalBoardRuntime {
  snapshot: LocalBoardSnapshot | null;
  hydrated: boolean;
  refreshing: boolean;
  flushing: boolean;
  pendingCount: number;
  failedCount: number;
  syncMode: 'node' | 'roaming';
  relayCount: number;
  lastError: string | null;
  refresh: () => Promise<void>;
  retryFailed: () => Promise<void>;
  createCard: (input: {
    title: string;
    description?: string;
    columnId: string;
    status?: Card['status'];
    priority?: Card['priority'];
  }) => Promise<Card>;
  updateCard: (cardId: string, input: Partial<Pick<
    Card,
    'title' | 'description' | 'status' | 'priority' | 'startAt' | 'dueAt' | 'completedAt'
  >>) => Promise<void>;
  moveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  archiveCard: (cardId: string) => Promise<void>;
  getCardChecklists: (cardId: string) => Checklist[];
  toggleChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
    isDone: boolean,
  ) => Promise<void>;
  cardOperationState: (cardId: string) => 'pending' | 'failed' | null;
}

function now() {
  return new Date().toISOString();
}

function operationBase(boardId: string, entityId: string) {
  return {
    id: Crypto.randomUUID(),
    boardId,
    entityId,
    status: 'pending' as const,
    createdAt: now(),
    attempts: 0,
    lastError: null,
  };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось синхронизировать изменения.';
}

export function useLocalBoard(boardId: string, workspaceId: string): LocalBoardRuntime {
  const { isOnline } = useNetwork();
  const [snapshot, setSnapshot] = useState<LocalBoardSnapshot | null>(null);
  const [operations, setOperations] = useState<LocalOperation[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<'node' | 'roaming'>('node');
  const [relayCount, setRelayCount] = useState(0);
  const snapshotRef = useRef<LocalBoardSnapshot | null>(null);
  const operationsRef = useRef<LocalOperation[]>([]);
  const roamingCapabilityRef = useRef<RoamingCapability | null>(null);
  const flushLock = useRef(false);
  const storageChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const runSerialized = useCallback(<T>(task: () => Promise<T>) => {
    const run = storageChainRef.current.then(task, task);
    storageChainRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const applyState = useCallback((nextSnapshot: LocalBoardSnapshot | null, nextOperations: LocalOperation[]) => {
    snapshotRef.current = nextSnapshot;
    operationsRef.current = nextOperations;
    setSnapshot(nextSnapshot);
    setOperations(nextOperations.filter((operation) => operation.boardId === boardId));
  }, [boardId]);

  const refresh = useCallback(async () => {
    if (!isOnline) return;
    setRefreshing(true);
    setLastError(null);
    let relaySucceeded = false;
    let relayReceived = 0;
    let relayFailure: unknown = null;
    try {
      await runSerialized(async () => {
        const storedCapability = roamingCapabilityRef.current
          || await loadRoamingCapability(boardId);
        if (storedCapability) {
          roamingCapabilityRef.current = storedCapability;
          try {
            const relay = await pullRoamingBoard(storedCapability, snapshotRef.current);
            relayReceived = relay.received;
            if (relay.snapshot) {
              const queued = await loadOperationQueue();
              await persistBoardAndQueue(relay.snapshot, queued);
              applyState(relay.snapshot, queued);
            }
            setSyncMode('roaming');
            setRelayCount(relay.relayCount);
            relaySucceeded = true;
          } catch (error) {
            relayFailure = error;
          }
        }

        await touchWorkspaceSync(workspaceId).catch(() => null);
        const [seeded, allOperations] = await Promise.all([
          fetchBoardSnapshot(boardId, workspaceId),
          loadOperationQueue(),
        ]);
        const merged = await persistServerSnapshot(seeded, allOperations);
        applyState(merged, allOperations);

        if (roamingCapabilityRef.current && relayReceived === 0) {
          await publishBoardSnapshot(roamingCapabilityRef.current, merged);
          relaySucceeded = true;
          setSyncMode('roaming');
          setRelayCount(roamingCapabilityRef.current.relays.length);
        } else if (!roamingCapabilityRef.current) {
          try {
            const capability = await provisionRoamingBoard(boardId);
            await installRoamingCapability(capability);
            roamingCapabilityRef.current = capability;
            await publishBoardSnapshot(capability, merged);
            setSyncMode('roaming');
            setRelayCount(capability.relays.length);
            relaySucceeded = true;
          } catch {
            // An older node simply keeps using the ordinary coordinator path.
          }
        }
      });
    } catch (error) {
      if (!relaySucceeded) setLastError(message(relayFailure || error));
    } finally {
      setRefreshing(false);
    }
  }, [applyState, boardId, isOnline, runSerialized, workspaceId]);

  const flush = useCallback(async () => {
    if (!isOnline || flushLock.current) return;
    flushLock.current = true;
    setFlushing(true);
    setLastError(null);

    try {
      await runSerialized(async () => {
        let allOperations = await loadOperationQueue();
        let currentSnapshot = snapshotRef.current;
        if (!currentSnapshot) return;
        const boardOperations = allOperations
          .filter((operation) => operation.boardId === boardId && operation.status === 'pending')
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

        for (const operation of boardOperations) {
          const current = allOperations.find((candidate) => candidate.id === operation.id);
          if (!current || current.status !== 'pending') continue;

          try {
            const roamingCapability = roamingCapabilityRef.current
              || await loadRoamingCapability(boardId);
            if (roamingCapability && !isTemporaryCardId(current.entityId)) {
              roamingCapabilityRef.current = roamingCapability;
              await publishLocalOperation(roamingCapability, current, currentSnapshot);
              allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
              setSyncMode('roaming');
              setRelayCount(roamingCapability.relays.length);
            } else if (current.kind === 'card.create') {
              const created = await createCard(boardId, current.payload.input);
              const replaced = replaceCreatedCard(
                currentSnapshot,
                allOperations,
                current.entityId,
                created,
              );
              currentSnapshot = replaced.snapshot;
              allOperations = replaced.operations.filter((candidate) => candidate.id !== current.id);
            } else if (current.kind === 'card.update') {
              if (isTemporaryCardId(current.entityId)) {
                throw new Error('Создание карточки ещё не отправлено.');
              }
              const updated = await updateCard(current.entityId, current.payload.input);
              currentSnapshot = {
                ...currentSnapshot,
                cards: currentSnapshot.cards.map((card) => card.id === updated.id ? updated : card),
              };
              allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
            } else if (current.kind === 'card.move') {
              if (isTemporaryCardId(current.entityId)) {
                throw new Error('Создание карточки ещё не отправлено.');
              }
              const moved = await moveCard(current.entityId, current.payload.input);
              currentSnapshot = {
                ...currentSnapshot,
                cards: currentSnapshot.cards.map((card) => card.id === moved.id ? moved : card),
              };
              allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
            } else if (current.kind === 'checklist.item.update') {
              const updated = await updateChecklistItem(
                current.entityId,
                current.payload.input,
              );
              currentSnapshot = replaceChecklistItem(
                currentSnapshot,
                current.payload.cardId,
                updated,
              );
              allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
            } else {
              if (isTemporaryCardId(current.entityId)) {
                throw new Error('Создание карточки ещё не отправлено.');
              }
              const archived = await archiveCard(current.entityId);
              currentSnapshot = {
                ...currentSnapshot,
                cards: currentSnapshot.cards.map((card) => card.id === archived.id ? archived : card),
              };
              allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
            }
            await persistBoardAndQueue(currentSnapshot, allOperations);
            applyState(currentSnapshot, allOperations);
          } catch (error) {
            if (roamingCapabilityRef.current || isNetworkError(error)) {
              setLastError(message(error));
              break;
            }
            const errorText = error instanceof ApiError && error.status === 403
              ? 'Изменение больше не разрешено. Проверьте доступ к пространству.'
              : message(error);
            allOperations = allOperations.map((candidate) => candidate.id === current.id
              ? {
                ...candidate,
                status: 'failed',
                attempts: candidate.attempts + 1,
                lastError: errorText,
              }
              : candidate);
            await persistBoardAndQueue(currentSnapshot, allOperations);
            applyState(currentSnapshot, allOperations);
            setLastError(errorText);
          }
        }
      });
    } finally {
      flushLock.current = false;
      setFlushing(false);
    }
  }, [applyState, boardId, isOnline, runSerialized]);

  useEffect(() => {
    let active = true;
    setHydrated(false);
    void Promise.all([
      loadLocalBoardState(boardId),
      loadRoamingCapability(boardId),
    ]).then(([local, capability]) => {
      if (!active) return;
      roamingCapabilityRef.current = capability;
      if (capability) {
        setSyncMode('roaming');
        setRelayCount(capability.relays.length);
      }
      applyState(local.snapshot, local.operations);
      setHydrated(true);
      if (isOnline) {
        const hasPending = local.operations.some((operation) => operation.status === 'pending');
        if (hasPending) {
          void flush().then(refresh);
        } else {
          void refresh();
        }
      }
    });
    return () => {
      active = false;
    };
  }, [applyState, boardId, flush, isOnline, refresh]);

  useEffect(() => {
    if (isOnline && operations.some((operation) => operation.status === 'pending')) {
      void flush();
    }
  }, [flush, isOnline, operations]);

  const enqueue = useCallback(async (operation: LocalOperation) => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot) throw new Error('Доска ещё не загружена.');
    await runSerialized(async () => {
      const allOperations = await loadOperationQueue();
      const nextOperations = [...allOperations, operation];
      const nextSnapshot = applyOperation(snapshotRef.current || currentSnapshot, operation);
      await persistBoardAndQueue(nextSnapshot, nextOperations);
      applyState(nextSnapshot, nextOperations);
    });
    if (isOnline) void flush();
  }, [applyState, flush, isOnline, runSerialized]);

  const retryFailed = useCallback(async () => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot) return;
    await runSerialized(async () => {
      const allOperations = await loadOperationQueue();
      const next = allOperations.map((operation) => operation.boardId === boardId && operation.status === 'failed'
        ? { ...operation, status: 'pending' as const, lastError: null }
        : operation);
      const latestSnapshot = snapshotRef.current || currentSnapshot;
      await persistBoardAndQueue(latestSnapshot, next);
      applyState(latestSnapshot, next);
    });
    await flush();
  }, [applyState, boardId, flush, runSerialized]);

  const pendingCount = operations.filter((operation) => operation.status === 'pending').length;
  const failedCount = operations.filter((operation) => operation.status === 'failed').length;

  return useMemo(() => ({
    snapshot,
    hydrated,
    refreshing,
    flushing,
    pendingCount,
    failedCount,
    syncMode,
    relayCount,
    lastError,
    refresh,
    retryFailed,
    createCard: async (input) => {
      if (!snapshotRef.current) throw new Error('Доска ещё не загружена.');
      const createdAt = now();
      const tempCard = createTemporaryCard({
        id: roamingCapabilityRef.current
          ? Crypto.randomUUID()
          : `local-card-${Crypto.randomUUID()}`,
        boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        cards: snapshotRef.current.cards,
        now: createdAt,
      });
      await enqueue({
        ...operationBase(boardId, tempCard.id),
        createdAt,
        kind: 'card.create',
        payload: { input, tempCard },
      });
      return tempCard;
    },
    updateCard: async (cardId, input) => enqueue({
      ...operationBase(boardId, cardId),
      kind: 'card.update',
      payload: { input },
    }),
    moveCard: async (cardId, targetColumnId) => enqueue({
      ...operationBase(boardId, cardId),
      kind: 'card.move',
      payload: { input: { targetColumnId } },
    }),
    archiveCard: async (cardId) => enqueue({
      ...operationBase(boardId, cardId),
      kind: 'card.archive',
      payload: {},
    }),
    getCardChecklists: (cardId) => snapshotRef.current?.checklistsByCardId[cardId] || [],
    toggleChecklistItem: async (cardId, checklistId, itemId, isDone) => enqueue({
      ...operationBase(boardId, itemId),
      kind: 'checklist.item.update',
      payload: {
        cardId,
        checklistId,
        input: { isDone },
      },
    }),
    cardOperationState: (cardId) => {
      const related = operations.filter((operation) => operation.entityId === cardId);
      if (related.some((operation) => operation.status === 'failed')) return 'failed';
      if (related.some((operation) => operation.status === 'pending')) return 'pending';
      return null;
    },
  }), [
    boardId,
    enqueue,
    failedCount,
    flushing,
    hydrated,
    lastError,
    operations,
    pendingCount,
    relayCount,
    refresh,
    refreshing,
    retryFailed,
    snapshot,
    syncMode,
  ]);
}
