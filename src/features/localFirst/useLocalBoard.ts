import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNetwork } from '../../app/NetworkProvider';
import { ApiError, isNetworkError } from '../../shared/api/client';
import {
  archiveCard as archiveCardRemote,
  createCard as createCardRemote,
  createChecklist as createChecklistRemote,
  createChecklistItem as createChecklistItemRemote,
  deleteCard as deleteCardRemote,
  deleteChecklist as deleteChecklistRemote,
  deleteChecklistItem as deleteChecklistItemRemote,
  moveCard as moveCardRemote,
  provisionRoamingBoard,
  unarchiveCard as unarchiveCardRemote,
  updateCard as updateCardRemote,
  updateChecklist as updateChecklistRemote,
  updateChecklistItem as updateChecklistItemRemote,
} from '../../shared/api/endpoints';
import type { Card, Checklist, ChecklistItem } from '../../shared/types/api';
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
  applyOperations,
  createTemporaryCard,
  createTemporaryChecklist,
  createTemporaryChecklistItem,
  isChecklistOperation,
  isTemporaryCardId,
  isTemporaryChecklistId,
  isTemporaryChecklistItemId,
  mergeBoardSnapshots,
  operationAffectsCard,
  operationCardId,
  replaceChecklist,
  replaceChecklistItem,
  replaceCreatedCard,
  replaceCreatedChecklist,
  replaceCreatedChecklistItem,
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
  moveCard: (
    cardId: string,
    targetColumnId: string,
    position?: number | null,
  ) => Promise<void>;
  archiveCard: (cardId: string) => Promise<void>;
  unarchiveCard: (cardId: string) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
  mergeCoordinatorCard: (card: Card) => Promise<void>;
  getCardChecklists: (cardId: string) => Checklist[];
  createChecklist: (cardId: string, title: string) => Promise<void>;
  updateChecklist: (cardId: string, checklistId: string, title: string) => Promise<void>;
  deleteChecklist: (cardId: string, checklistId: string) => Promise<void>;
  createChecklistItem: (
    cardId: string,
    checklistId: string,
    title: string,
  ) => Promise<void>;
  updateChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
    input: { title?: string; position?: number | null; isDone?: boolean | null },
  ) => Promise<void>;
  deleteChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
  ) => Promise<void>;
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

function coordinatorUnavailable(error: unknown) {
  return isNetworkError(error)
    || (error instanceof ApiError && [408, 502, 503, 504].includes(error.status));
}

function canPublishThroughRoaming(operation: LocalOperation) {
  if (isTemporaryCardId(operationCardId(operation))) return false;
  if (isTemporaryChecklistId(operation.entityId)) return false;
  if (isTemporaryChecklistItemId(operation.entityId)) return false;
  if (
    isChecklistOperation(operation)
    && 'checklistId' in operation.payload
    && isTemporaryChecklistId(operation.payload.checklistId)
  ) return false;
  return true;
}

function replaceCardInSnapshot(snapshot: LocalBoardSnapshot, card: Card) {
  return {
    ...snapshot,
    cards: snapshot.cards.map((candidate) => candidate.id === card.id ? card : candidate),
    cachedAt: card.updatedAt,
  };
}

function removeCardFromSnapshot(snapshot: LocalBoardSnapshot, cardId: string) {
  const checklistsByCardId = { ...snapshot.checklistsByCardId };
  delete checklistsByCardId[cardId];
  return {
    ...snapshot,
    cards: snapshot.cards.filter((card) => card.id !== cardId),
    checklistsByCardId,
    cachedAt: now(),
  };
}

function nextCardPosition(snapshot: LocalBoardSnapshot, columnId: string, cardId: string) {
  return snapshot.cards
    .filter((card) => card.columnId === columnId && card.id !== cardId && !card.isArchived)
    .reduce((highest, card) => Math.max(highest, card.position), 0) + 1000;
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
  const nodeUnavailableUntilRef = useRef(0);

  const runSerialized = useCallback(<T>(task: () => Promise<T>) => {
    const run = storageChainRef.current.then(task, task);
    storageChainRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const applyState = useCallback((
    nextSnapshot: LocalBoardSnapshot | null,
    nextOperations: LocalOperation[],
  ) => {
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
    let relaySnapshot: LocalBoardSnapshot | null = null;
    try {
      await runSerialized(async () => {
        const storedCapability = roamingCapabilityRef.current
          || await loadRoamingCapability(boardId);
        if (storedCapability) {
          roamingCapabilityRef.current = storedCapability;
          try {
            const relay = await pullRoamingBoard(storedCapability, snapshotRef.current);
            relayReceived = relay.received;
            relaySnapshot = relay.snapshot;
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

        try {
          await touchWorkspaceSync(workspaceId).catch(() => null);
          const [seeded, allOperations] = await Promise.all([
            fetchBoardSnapshot(boardId, workspaceId),
            loadOperationQueue(),
          ]);
          nodeUnavailableUntilRef.current = 0;
          const mergedBase = mergeBoardSnapshots(seeded, relaySnapshot);
          const merged = await persistServerSnapshot(mergedBase, allOperations);
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
              // Узел без roaming продолжает работать как обычный координатор.
            }
          }
        } catch (error) {
          if (coordinatorUnavailable(error)) {
            nodeUnavailableUntilRef.current = Date.now() + 30_000;
          }
          if (!relaySucceeded) throw error;
        }
      });
    } catch (error) {
      setLastError(message(relayFailure || error));
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
        const initialSnapshot = snapshotRef.current;
        if (!initialSnapshot) return;
        let currentSnapshot: LocalBoardSnapshot = initialSnapshot;
        const boardOperations = allOperations
          .filter((operation) => operation.boardId === boardId && operation.status === 'pending')
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

        for (const queuedOperation of boardOperations) {
          const current = allOperations.find((candidate) => candidate.id === queuedOperation.id);
          if (!current || current.status !== 'pending') continue;

          const capability = roamingCapabilityRef.current
            || await loadRoamingCapability(boardId);
          if (capability) roamingCapabilityRef.current = capability;

          const publishFallback = async () => {
            if (!capability || !canPublishThroughRoaming(current)) return false;
            await publishLocalOperation(capability, current, currentSnapshot);
            allOperations = allOperations.filter((candidate) => candidate.id !== current.id);
            await persistBoardAndQueue(currentSnapshot, allOperations);
            applyState(currentSnapshot, allOperations);
            setSyncMode('roaming');
            setRelayCount(capability.relays.length);
            return true;
          };

          if (nodeUnavailableUntilRef.current > Date.now()) {
            try {
              if (await publishFallback()) continue;
            } catch (error) {
              setLastError(message(error));
              break;
            }
          }

          try {
            let relayOperation: LocalOperation = current;
            let nextSnapshot: LocalBoardSnapshot = currentSnapshot;
            let nextOperations = allOperations;

            if (current.kind === 'card.create') {
              const created = await createCardRemote(boardId, current.payload.input);
              const replaced = replaceCreatedCard(
                nextSnapshot,
                nextOperations,
                current.entityId,
                created,
              );
              nextSnapshot = replaced.snapshot;
              nextOperations = replaced.operations;
              relayOperation = {
                ...current,
                entityId: created.id,
                payload: { ...current.payload, tempCard: created },
              };
            } else if (current.kind === 'card.update') {
              const updated = await updateCardRemote(current.entityId, current.payload.input);
              nextSnapshot = replaceCardInSnapshot(nextSnapshot, updated);
            } else if (current.kind === 'card.move') {
              const moved = await moveCardRemote(current.entityId, current.payload.input);
              nextSnapshot = replaceCardInSnapshot(nextSnapshot, moved);
            } else if (current.kind === 'card.archive') {
              const archived = await archiveCardRemote(current.entityId);
              nextSnapshot = replaceCardInSnapshot(nextSnapshot, archived);
            } else if (current.kind === 'card.unarchive') {
              const restored = await unarchiveCardRemote(current.entityId);
              nextSnapshot = replaceCardInSnapshot(nextSnapshot, restored);
            } else if (current.kind === 'checklist.create') {
              const created = await createChecklistRemote(
                current.payload.cardId,
                current.payload.input,
              );
              const replaced = replaceCreatedChecklist(
                nextSnapshot,
                nextOperations,
                current.payload.cardId,
                current.entityId,
                created,
              );
              nextSnapshot = replaced.snapshot;
              nextOperations = replaced.operations;
              relayOperation = {
                ...current,
                entityId: created.id,
                payload: { ...current.payload, tempChecklist: created },
              };
            } else if (current.kind === 'checklist.update') {
              const updated = await updateChecklistRemote(
                current.entityId,
                current.payload.input,
              );
              nextSnapshot = replaceChecklist(nextSnapshot, current.payload.cardId, updated);
            } else if (current.kind === 'checklist.delete') {
              await deleteChecklistRemote(current.entityId);
            } else if (current.kind === 'checklist.item.create') {
              const created = await createChecklistItemRemote(
                current.payload.checklistId,
                current.payload.input,
              );
              const replaced = replaceCreatedChecklistItem(
                nextSnapshot,
                nextOperations,
                current.payload.cardId,
                current.entityId,
                created,
              );
              nextSnapshot = replaced.snapshot;
              nextOperations = replaced.operations;
              relayOperation = {
                ...current,
                entityId: created.id,
                payload: { ...current.payload, tempItem: created },
              };
            } else if (current.kind === 'checklist.item.update') {
              const updated = await updateChecklistItemRemote(
                current.entityId,
                current.payload.input,
              );
              nextSnapshot = replaceChecklistItem(
                nextSnapshot,
                current.payload.cardId,
                updated,
              );
            } else {
              await deleteChecklistItemRemote(current.entityId);
            }

            nodeUnavailableUntilRef.current = 0;
            nextOperations = nextOperations.filter((candidate) => candidate.id !== current.id);
            nextSnapshot = applyOperations(
              nextSnapshot,
              nextOperations.filter((operation) => operation.boardId === boardId),
            );
            currentSnapshot = nextSnapshot;
            allOperations = nextOperations;
            await persistBoardAndQueue(currentSnapshot, allOperations);
            applyState(currentSnapshot, allOperations);

            if (capability && canPublishThroughRoaming(relayOperation)) {
              void publishLocalOperation(
                capability,
                relayOperation,
                currentSnapshot,
              ).catch(() => null);
            }
          } catch (error) {
            if (coordinatorUnavailable(error)) {
              nodeUnavailableUntilRef.current = Date.now() + 30_000;
              try {
                if (await publishFallback()) continue;
              } catch (relayError) {
                setLastError(message(relayError));
                break;
              }
              setLastError(
                'Локальный узел недоступен, а это изменение ещё нельзя отправить через relay.',
              );
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
      const next = allOperations.map((operation) =>
        operation.boardId === boardId && operation.status === 'failed'
          ? { ...operation, status: 'pending' as const, lastError: null }
          : operation);
      const latestSnapshot = snapshotRef.current || currentSnapshot;
      await persistBoardAndQueue(latestSnapshot, next);
      applyState(latestSnapshot, next);
    });
    nodeUnavailableUntilRef.current = 0;
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
    moveCard: async (cardId, targetColumnId, position) => {
      const current = snapshotRef.current;
      if (!current) throw new Error('Доска ещё не загружена.');
      await enqueue({
        ...operationBase(boardId, cardId),
        kind: 'card.move',
        payload: {
          input: {
            targetColumnId,
            position: position ?? nextCardPosition(current, targetColumnId, cardId),
          },
        },
      });
    },
    archiveCard: async (cardId) => enqueue({
      ...operationBase(boardId, cardId),
      kind: 'card.archive',
      payload: {},
    }),
    unarchiveCard: async (cardId) => enqueue({
      ...operationBase(boardId, cardId),
      kind: 'card.unarchive',
      payload: {},
    }),
    deleteCard: async (cardId) => {
      const current = snapshotRef.current;
      if (!current) return;
      const allOperations = await loadOperationQueue();
      const isUnsyncedCreate = allOperations.some((operation) =>
        operation.kind === 'card.create' && operation.entityId === cardId);
      if (!isUnsyncedCreate) {
        await deleteCardRemote(cardId);
      }
      await runSerialized(async () => {
        const latestOperations = await loadOperationQueue();
        const nextOperations = latestOperations.filter((operation) =>
          !operationAffectsCard(operation, cardId));
        const nextSnapshot = removeCardFromSnapshot(
          snapshotRef.current || current,
          cardId,
        );
        await persistBoardAndQueue(nextSnapshot, nextOperations);
        applyState(nextSnapshot, nextOperations);
      });
    },
    mergeCoordinatorCard: async (card) => {
      const current = snapshotRef.current;
      if (!current) return;
      await runSerialized(async () => {
        const allOperations = await loadOperationQueue();
        const nextSnapshot = applyOperations(
          replaceCardInSnapshot(snapshotRef.current || current, card),
          allOperations.filter((operation) => operation.boardId === boardId),
        );
        await persistBoardAndQueue(nextSnapshot, allOperations);
        applyState(nextSnapshot, allOperations);
      });
    },
    getCardChecklists: (cardId) => snapshotRef.current?.checklistsByCardId[cardId] || [],
    createChecklist: async (cardId, title) => {
      const current = snapshotRef.current;
      if (!current) throw new Error('Доска ещё не загружена.');
      const createdAt = now();
      const tempChecklist = createTemporaryChecklist({
        id: roamingCapabilityRef.current
          ? Crypto.randomUUID()
          : `local-checklist-${Crypto.randomUUID()}`,
        cardId,
        title,
        checklists: current.checklistsByCardId[cardId] || [],
        now: createdAt,
      });
      await enqueue({
        ...operationBase(boardId, tempChecklist.id),
        createdAt,
        kind: 'checklist.create',
        payload: {
          cardId,
          input: { title, position: tempChecklist.position },
          tempChecklist,
        },
      });
    },
    updateChecklist: async (cardId, checklistId, title) => enqueue({
      ...operationBase(boardId, checklistId),
      kind: 'checklist.update',
      payload: { cardId, input: { title } },
    }),
    deleteChecklist: async (cardId, checklistId) => enqueue({
      ...operationBase(boardId, checklistId),
      kind: 'checklist.delete',
      payload: { cardId },
    }),
    createChecklistItem: async (cardId, checklistId, title) => {
      const current = snapshotRef.current;
      if (!current) throw new Error('Доска ещё не загружена.');
      const checklist = (current.checklistsByCardId[cardId] || [])
        .find((candidate) => candidate.id === checklistId);
      if (!checklist) throw new Error('Чек-лист не найден.');
      const createdAt = now();
      const tempItem = createTemporaryChecklistItem({
        id: roamingCapabilityRef.current
          ? Crypto.randomUUID()
          : `local-checklist-item-${Crypto.randomUUID()}`,
        checklistId,
        title,
        items: checklist.items,
        now: createdAt,
      });
      await enqueue({
        ...operationBase(boardId, tempItem.id),
        createdAt,
        kind: 'checklist.item.create',
        payload: {
          cardId,
          checklistId,
          input: { title, position: tempItem.position },
          tempItem,
        },
      });
    },
    updateChecklistItem: async (cardId, checklistId, itemId, input) => enqueue({
      ...operationBase(boardId, itemId),
      kind: 'checklist.item.update',
      payload: { cardId, checklistId, input },
    }),
    deleteChecklistItem: async (cardId, checklistId, itemId) => enqueue({
      ...operationBase(boardId, itemId),
      kind: 'checklist.item.delete',
      payload: { cardId, checklistId },
    }),
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
      const related = operations.filter((operation) =>
        operationAffectsCard(operation, cardId));
      if (related.some((operation) => operation.status === 'failed')) return 'failed';
      if (related.some((operation) => operation.status === 'pending')) return 'pending';
      return null;
    },
  }), [
    applyState,
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
    runSerialized,
    snapshot,
    syncMode,
  ]);
}
