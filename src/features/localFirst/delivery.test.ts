import {
  awaitsCoordinatorConfirmation,
  markRelayAccepted,
  relayCreateRequiresProjectionConfirmation,
} from './delivery';
import type { MoveCardOperation } from './model';

describe('local-first delivery states', () => {
  const move: MoveCardOperation = {
    id: 'operation-1',
    boardId: 'board-1',
    entityId: 'card-1',
    kind: 'card.move',
    status: 'pending',
    accessEpoch: 4,
    attempts: 0,
    lastError: 'temporary relay failure',
    createdAt: '2026-08-25T12:00:00.000Z',
    payload: {
      input: { targetColumnId: 'column-2', position: 1000 },
    },
  };

  it('keeps a relay-acknowledged move queued for the coordinator', () => {
    const accepted = markRelayAccepted(move);

    expect(accepted.status).toBe('relay_pending');
    expect(accepted.attempts).toBe(1);
    expect(accepted.lastError).toBeNull();
    expect(awaitsCoordinatorConfirmation(accepted)).toBe(true);
  });

  it('does not treat a failed operation as coordinator pending', () => {
    expect(awaitsCoordinatorConfirmation({ ...move, status: 'failed' })).toBe(false);
  });

  it('does not replay a relay-created entity through a second create API', () => {
    expect(relayCreateRequiresProjectionConfirmation({
      ...move,
      kind: 'card.create',
      status: 'relay_pending',
      payload: {
        input: { title: 'Новая', columnId: 'column-2' },
        tempCard: {
          id: 'card-1',
          boardId: 'board-1',
          columnId: 'column-2',
          title: 'Новая',
          description: null,
          priority: null,
          position: 1000,
          startAt: null,
          dueAt: null,
          isArchived: false,
          checklistCount: 0,
          checklistItemCount: 0,
          checklistCompletedItemCount: 0,
          createdAt: move.createdAt,
          updatedAt: move.createdAt,
        },
      },
    })).toBe(true);
  });
});
