import type { Card, Checklist } from '../../shared/types/api';
import {
  LOCAL_SCHEMA_VERSION,
  type LocalBoardSnapshot,
} from '../localFirst/model';
import { compareVersion, stampOf } from './codec';
import type {
  RoamingApplyState,
  RoamingBoardEvent,
  RoamingVersionStamp,
} from './types';

const CARD_FIELDS: Array<keyof Card> = [
  'boardId',
  'columnId',
  'parentCardId',
  'title',
  'description',
  'status',
  'priority',
  'position',
  'startAt',
  'dueAt',
  'completedAt',
  'isArchived',
  'archivedAt',
  'updatedAt',
];
const CHECKLISTS_FIELD = 'checklists';

export const EMPTY_ROAMING_APPLY_STATE: RoamingApplyState = {
  seenEventIds: [],
  fieldVersions: {},
  lastRelayPullAt: 0,
};

function fieldKey(entityId: string, field: string) {
  return `${entityId}:${field}`;
}

function eventWins(
  versions: Record<string, RoamingVersionStamp>,
  entityId: string,
  field: string,
  candidate: RoamingVersionStamp,
) {
  const current = versions[fieldKey(entityId, field)];
  return !current || compareVersion(candidate, current) > 0;
}

export function applyRoamingEvents(
  currentSnapshot: LocalBoardSnapshot | null,
  currentState: RoamingApplyState,
  events: RoamingBoardEvent[],
) {
  let snapshot = currentSnapshot;
  const seen = new Set(currentState.seenEventIds);
  const versions = { ...currentState.fieldVersions };
  let applied = 0;

  const ordered = [...events].sort((left, right) => compareVersion(stampOf(left), stampOf(right)));
  for (const event of ordered) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);

    if (event.operation === 'board.snapshot') {
      if (!snapshot) {
        const candidate = event.payload.snapshot as LocalBoardSnapshot | undefined;
        if (
          candidate
          && candidate.workspaceId === event.workspaceId
          && candidate.board.id === event.boardId
        ) {
          snapshot = {
            ...candidate,
            schemaVersion: LOCAL_SCHEMA_VERSION,
            checklistsByCardId: candidate.checklistsByCardId || {},
            checklistsHydratedAt: candidate.checklistsHydratedAt || null,
          };
          const stamp = stampOf(event);
          for (const card of snapshot.cards) {
            for (const field of CARD_FIELDS) versions[fieldKey(card.id, field)] = stamp;
            versions[fieldKey(card.id, CHECKLISTS_FIELD)] = stamp;
          }
          applied += 1;
        }
      }
      continue;
    }

    if (!snapshot || event.operation !== 'card.put') continue;
    const incoming = event.payload.card as Card | undefined;
    const incomingChecklists = Array.isArray(event.payload.checklists)
      ? event.payload.checklists as Checklist[]
      : null;
    if (!incoming || incoming.id !== event.entityId || incoming.boardId !== snapshot.board.id) {
      continue;
    }

    const stamp = stampOf(event);
    const fields = event.fieldMask.includes('*')
      ? CARD_FIELDS
      : CARD_FIELDS.filter((field) => event.fieldMask.includes(field));
    const includesChecklists = Boolean(
      incomingChecklists
      && (event.fieldMask.includes('*') || event.fieldMask.includes(CHECKLISTS_FIELD)),
    );
    const existing = snapshot.cards.find((card) => card.id === incoming.id);
    if (!existing) {
      snapshot = {
        ...snapshot,
        cards: [...snapshot.cards, incoming],
        checklistsByCardId: incomingChecklists
          ? { ...snapshot.checklistsByCardId, [incoming.id]: incomingChecklists }
          : snapshot.checklistsByCardId,
        cachedAt: event.occurredAt,
      };
      for (const field of CARD_FIELDS) versions[fieldKey(incoming.id, field)] = stamp;
      if (incomingChecklists) versions[fieldKey(incoming.id, CHECKLISTS_FIELD)] = stamp;
      applied += 1;
      continue;
    }

    let changed = false;
    const next = { ...existing };
    for (const field of fields) {
      if (!eventWins(versions, incoming.id, field, stamp)) continue;
      Object.assign(next, { [field]: incoming[field] });
      versions[fieldKey(incoming.id, field)] = stamp;
      changed = true;
    }
    if (changed) {
      snapshot = {
        ...snapshot,
        cards: snapshot.cards.map((card) => card.id === next.id ? next : card),
        cachedAt: event.occurredAt,
      };
      applied += 1;
    }
    if (
      includesChecklists
      && eventWins(versions, incoming.id, CHECKLISTS_FIELD, stamp)
    ) {
      snapshot = {
        ...snapshot,
        checklistsByCardId: {
          ...snapshot.checklistsByCardId,
          [incoming.id]: incomingChecklists || [],
        },
        cachedAt: event.occurredAt,
      };
      versions[fieldKey(incoming.id, CHECKLISTS_FIELD)] = stamp;
      if (!changed) applied += 1;
    }
  }

  return {
    snapshot,
    applied,
    state: {
      seenEventIds: [...seen].slice(-5000),
      fieldVersions: versions,
      lastRelayPullAt: currentState.lastRelayPullAt,
    } satisfies RoamingApplyState,
  };
}
