import type { LocalBoardSnapshot, LocalOperation } from './model';

/**
 * A relay acknowledgement only proves durable relay storage.  The operation
 * remains in the local queue until the coordinator accepts it.
 */
export function markRelayAccepted(operation: LocalOperation): LocalOperation {
  return {
    ...operation,
    status: 'relay_pending',
    attempts: operation.attempts + 1,
    lastError: null,
  };
}

export function awaitsCoordinatorConfirmation(operation: LocalOperation) {
  return operation.status === 'pending' || operation.status === 'relay_pending';
}

function checklist(snapshot: LocalBoardSnapshot, cardId: string, checklistId: string) {
  return (snapshot.checklistsByCardId[cardId] || [])
    .find((candidate) => candidate.id === checklistId);
}

/**
 * Projection-level confirmation lets relay-created entities leave the queue
 * without issuing a second create request with a different coordinator ID.
 */
export function relayOperationIsInCoordinatorSnapshot(
  operation: LocalOperation,
  snapshot: LocalBoardSnapshot,
) {
  if (operation.status !== 'relay_pending') return false;
  if (operation.kind === 'card.create') {
    return snapshot.cards.some((card) => card.id === operation.entityId);
  }
  if (operation.kind === 'card.move') {
    const card = snapshot.cards.find((candidate) => candidate.id === operation.entityId);
    return Boolean(card && card.columnId === operation.payload.input.targetColumnId);
  }
  if (operation.kind === 'card.archive' || operation.kind === 'card.unarchive') {
    const card = snapshot.cards.find((candidate) => candidate.id === operation.entityId);
    return Boolean(card && card.isArchived === (operation.kind === 'card.archive'));
  }
  if (operation.kind === 'card.delete') {
    return !snapshot.cards.some((card) => card.id === operation.entityId);
  }
  if (operation.kind === 'checklist.create') {
    return Boolean(checklist(snapshot, operation.payload.cardId, operation.entityId));
  }
  if (operation.kind === 'checklist.delete') {
    return !checklist(snapshot, operation.payload.cardId, operation.entityId);
  }
  if (operation.kind === 'checklist.item.create') {
    return Boolean(checklist(
      snapshot,
      operation.payload.cardId,
      operation.payload.checklistId,
    )?.items.some((item) => item.id === operation.entityId));
  }
  if (operation.kind === 'checklist.item.delete') {
    return !checklist(
      snapshot,
      operation.payload.cardId,
      operation.payload.checklistId,
    )?.items.some((item) => item.id === operation.entityId);
  }
  return false;
}

export function relayCreateRequiresProjectionConfirmation(operation: LocalOperation) {
  return operation.status === 'relay_pending' && (
    operation.kind === 'card.create'
    || operation.kind === 'checklist.create'
    || operation.kind === 'checklist.item.create'
  );
}
