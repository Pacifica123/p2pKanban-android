import type { Card, Checklist, ChecklistItem } from '../../shared/types/api';
import { defaultBoardAppearance } from '../appearance/boardTheme';
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
  'priority',
  'position',
  'startAt',
  'dueAt',
  'isArchived',
  'archivedAt',
  'updatedAt',
];
const CHECKLISTS_FIELD = 'checklists';
const BOARD_APPEARANCE_FIELD = 'board.appearance';

export const EMPTY_ROAMING_APPLY_STATE: RoamingApplyState = {
  seenEventIds: [],
  fieldVersions: {},
  tombstones: {},
  checklistTombstones: {},
  checklistItemTombstones: {},
  lastRelayPullAt: 0,
};

function fieldKey(entityId: string, field: string) {
  return `${entityId}:${field}`;
}

function stripRemovedCardState(
  value: Card & { status?: unknown; completedAt?: unknown },
): Card {
  const { status: _status, completedAt: _completedAt, ...card } = value;
  return card;
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

function mergeLegacyItems(existing: ChecklistItem[], incoming: ChecklistItem[]) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.position - right.position);
}

function mergeLegacyChecklists(existing: Checklist[], incoming: Checklist[]) {
  const byId = new Map(existing.map((checklist) => [checklist.id, checklist]));
  for (const checklist of incoming) {
    const current = byId.get(checklist.id);
    byId.set(checklist.id, current
      ? { ...current, items: mergeLegacyItems(current.items, checklist.items) }
      : checklist);
  }
  return [...byId.values()].sort((left, right) => left.position - right.position);
}

function withChecklistCounts(snapshot: LocalBoardSnapshot, cardId: string, timestamp: string) {
  const checklists = snapshot.checklistsByCardId[cardId] || [];
  const items = checklists.flatMap((checklist) => checklist.items);
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => card.id === cardId
      ? {
        ...card,
        checklistCount: checklists.length,
        checklistItemCount: items.length,
        checklistCompletedItemCount: items.filter((item) => item.isDone).length,
        updatedAt: timestamp,
      }
      : card),
    checklistsHydratedAt: [snapshot.checklistsHydratedAt, timestamp]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || timestamp,
    cachedAt: timestamp,
  };
}

function deltaString(delta: Record<string, unknown>, key: string) {
  return typeof delta[key] === 'string' ? delta[key] as string : null;
}

function deltaFields(delta: Record<string, unknown>) {
  return Array.isArray(delta.fieldMask)
    ? delta.fieldMask.filter((field): field is string => typeof field === 'string')
    : [];
}

function applyChecklistDelta(
  snapshot: LocalBoardSnapshot,
  event: RoamingBoardEvent,
  versions: Record<string, RoamingVersionStamp>,
  checklistTombstones: Record<string, RoamingVersionStamp>,
  checklistItemTombstones: Record<string, RoamingVersionStamp>,
) {
  const raw = event.payload.checklistDelta;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { snapshot, changed: false };
  }
  const delta = raw as Record<string, unknown>;
  const kind = deltaString(delta, 'kind');
  const cardId = deltaString(delta, 'cardId');
  if (!kind || cardId !== event.entityId || !snapshot.cards.some((card) => card.id === cardId)) {
    return { snapshot, changed: false };
  }
  const stamp = stampOf(event);
  const fields = deltaFields(delta);
  const allFields = fields.includes('*');
  const wants = (field: string) => allFields || fields.includes(field);
  let changed = false;
  let next = snapshot;

  if (kind === 'checklist.delete') {
    const checklistId = deltaString(delta, 'checklistId');
    if (!checklistId || !eventWins(versions, checklistId, 'checklist.__lifecycle', stamp)) {
      return { snapshot, changed: false };
    }
    versions[fieldKey(checklistId, 'checklist.__lifecycle')] = stamp;
    const current = next.checklistsByCardId[cardId] || [];
    if (current.some((checklist) => checklist.id === checklistId)) {
      next = {
        ...next,
        checklistsByCardId: {
          ...next.checklistsByCardId,
          [cardId]: current.filter((checklist) => checklist.id !== checklistId),
        },
      };
      changed = true;
    }
    checklistTombstones[checklistId] = stamp;
  } else if (kind === 'checklist.put') {
    const checklistId = deltaString(delta, 'checklistId');
    const incoming = delta.checklist as Checklist | undefined;
    if (!checklistId || !incoming || incoming.id !== checklistId || incoming.cardId !== cardId) {
      return { snapshot, changed: false };
    }
    const tombstone = checklistTombstones[checklistId];
    if (tombstone && (!allFields || compareVersion(stamp, tombstone) <= 0)) {
      return { snapshot, changed: false };
    }
    const current = next.checklistsByCardId[cardId] || [];
    const existing = current.find((checklist) => checklist.id === checklistId);
    if (!existing) {
      if (!eventWins(versions, checklistId, 'checklist.__lifecycle', stamp)) {
        return { snapshot, changed: false };
      }
      const items = Array.isArray(incoming.items)
        ? incoming.items.filter((item) => !checklistItemTombstones[item.id])
        : [];
      next = {
        ...next,
        checklistsByCardId: {
          ...next.checklistsByCardId,
          [cardId]: [...current, { ...incoming, items }]
            .sort((left, right) => left.position - right.position),
        },
      };
      versions[fieldKey(checklistId, 'checklist.__lifecycle')] = stamp;
      versions[fieldKey(checklistId, 'checklist.title')] = stamp;
      versions[fieldKey(checklistId, 'checklist.position')] = stamp;
      delete checklistTombstones[checklistId];
      changed = true;
    } else {
      const updated = { ...existing };
      for (const field of ['title', 'position'] as const) {
        if (!wants(field) || !eventWins(versions, checklistId, `checklist.${field}`, stamp)) continue;
        versions[fieldKey(checklistId, `checklist.${field}`)] = stamp;
        if (updated[field] !== incoming[field]) {
          Object.assign(updated, { [field]: incoming[field] });
          changed = true;
        }
      }
      if (allFields && eventWins(versions, checklistId, 'checklist.__lifecycle', stamp)) {
        versions[fieldKey(checklistId, 'checklist.__lifecycle')] = stamp;
        delete checklistTombstones[checklistId];
      }
      if (changed) {
        next = {
          ...next,
          checklistsByCardId: {
            ...next.checklistsByCardId,
            [cardId]: current.map((checklist) => checklist.id === checklistId
              ? { ...updated, updatedAt: event.occurredAt }
              : checklist),
          },
        };
      }
    }
  } else if (kind === 'checklist_item.delete') {
    const itemId = deltaString(delta, 'itemId');
    if (!itemId || !eventWins(versions, itemId, 'checklist_item.__lifecycle', stamp)) {
      return { snapshot, changed: false };
    }
    versions[fieldKey(itemId, 'checklist_item.__lifecycle')] = stamp;
    const checklists = next.checklistsByCardId[cardId] || [];
    const updated = checklists.map((checklist) => {
      if (!checklist.items.some((item) => item.id === itemId)) return checklist;
      changed = true;
      return {
        ...checklist,
        items: checklist.items.filter((item) => item.id !== itemId),
        updatedAt: event.occurredAt,
      };
    });
    if (changed) {
      next = {
        ...next,
        checklistsByCardId: { ...next.checklistsByCardId, [cardId]: updated },
      };
    }
    checklistItemTombstones[itemId] = stamp;
  } else if (kind === 'checklist_item.put') {
    const checklistId = deltaString(delta, 'checklistId');
    const itemId = deltaString(delta, 'itemId');
    const incoming = delta.item as ChecklistItem | undefined;
    if (
      !checklistId
      || !itemId
      || !incoming
      || incoming.id !== itemId
      || incoming.checklistId !== checklistId
      || checklistTombstones[checklistId]
    ) {
      return { snapshot, changed: false };
    }
    const tombstone = checklistItemTombstones[itemId];
    if (tombstone && (!allFields || compareVersion(stamp, tombstone) <= 0)) {
      return { snapshot, changed: false };
    }
    const checklists = next.checklistsByCardId[cardId] || [];
    const checklist = checklists.find((candidate) => candidate.id === checklistId);
    if (!checklist) return { snapshot, changed: false };
    const existing = checklist.items.find((item) => item.id === itemId);
    let nextItems = checklist.items;
    if (!existing) {
      if (!eventWins(versions, itemId, 'checklist_item.__lifecycle', stamp)) {
        return { snapshot, changed: false };
      }
      nextItems = [...checklist.items, incoming]
        .sort((left, right) => left.position - right.position);
      versions[fieldKey(itemId, 'checklist_item.__lifecycle')] = stamp;
      for (const field of ['title', 'position', 'isDone']) {
        versions[fieldKey(itemId, `checklist_item.${field}`)] = stamp;
      }
      delete checklistItemTombstones[itemId];
      changed = true;
    } else {
      const updated = { ...existing };
      for (const field of ['title', 'position', 'isDone'] as const) {
        if (!wants(field) || !eventWins(versions, itemId, `checklist_item.${field}`, stamp)) continue;
        versions[fieldKey(itemId, `checklist_item.${field}`)] = stamp;
        if (updated[field] !== incoming[field]) {
          Object.assign(updated, { [field]: incoming[field] });
          changed = true;
        }
      }
      if (allFields && eventWins(versions, itemId, 'checklist_item.__lifecycle', stamp)) {
        versions[fieldKey(itemId, 'checklist_item.__lifecycle')] = stamp;
        delete checklistItemTombstones[itemId];
      }
      if (changed) {
        nextItems = checklist.items.map((item) => item.id === itemId
          ? {
            ...updated,
            completedAt: updated.isDone
              ? updated.completedAt || event.occurredAt
              : null,
            updatedAt: event.occurredAt,
          }
          : item);
      }
    }
    if (changed) {
      next = {
        ...next,
        checklistsByCardId: {
          ...next.checklistsByCardId,
          [cardId]: checklists.map((candidate) => candidate.id === checklistId
            ? { ...candidate, items: nextItems, updatedAt: event.occurredAt }
            : candidate),
        },
      };
    }
  }

  return {
    snapshot: changed ? withChecklistCounts(next, cardId, event.occurredAt) : next,
    changed,
  };
}

export function applyRoamingEvents(
  currentSnapshot: LocalBoardSnapshot | null,
  currentState: RoamingApplyState,
  events: RoamingBoardEvent[],
) {
  let snapshot = currentSnapshot;
  const seen = new Set(currentState.seenEventIds);
  const versions = { ...currentState.fieldVersions };
  const tombstones = { ...(currentState.tombstones || {}) };
  const checklistTombstones = { ...(currentState.checklistTombstones || {}) };
  const checklistItemTombstones = { ...(currentState.checklistItemTombstones || {}) };
  let applied = 0;

  const ordered = [...events].sort((left, right) => compareVersion(stampOf(left), stampOf(right)));
  for (const event of ordered) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);

    if (event.operation === 'card.delete') {
      const current = tombstones[event.entityId];
      const candidate = stampOf(event);
      if (!current || compareVersion(candidate, current) > 0) {
        tombstones[event.entityId] = candidate;
      }
      if (snapshot?.cards.some((card) => card.id === event.entityId)) {
        const checklistsByCardId = { ...snapshot.checklistsByCardId };
        delete checklistsByCardId[event.entityId];
        snapshot = {
          ...snapshot,
          cards: snapshot.cards.filter((card) => card.id !== event.entityId),
          checklistsByCardId,
          cachedAt: event.occurredAt,
        };
      }
      applied += 1;
      continue;
    }

    if (event.operation === 'board.appearance.put') {
      const incoming = event.payload.appearance as LocalBoardSnapshot['appearance'] | undefined;
      const stamp = stampOf(event);
      if (!snapshot) {
        seen.delete(event.eventId);
        continue;
      }
      if (
        incoming?.boardId === snapshot.board.id
        && event.entityId === snapshot.board.id
        && eventWins(versions, snapshot.board.id, BOARD_APPEARANCE_FIELD, stamp)
      ) {
        versions[fieldKey(snapshot.board.id, BOARD_APPEARANCE_FIELD)] = stamp;
        if (JSON.stringify(snapshot.appearance) !== JSON.stringify(incoming)) {
          snapshot = { ...snapshot, appearance: incoming, cachedAt: event.occurredAt };
          applied += 1;
        }
      }
      continue;
    }

    if (event.operation === 'board.snapshot') {
      const candidate = event.payload.snapshot as LocalBoardSnapshot | undefined;
      if (
        candidate
        && candidate.workspaceId === event.workspaceId
        && candidate.board.id === event.boardId
      ) {
        const stamp = stampOf(event);
        if (!snapshot) {
          const visibleCards = candidate.cards
            .filter((card) => !tombstones[card.id])
            .map((card) => stripRemovedCardState(
              card as Card & { status?: unknown; completedAt?: unknown },
            ));
          snapshot = {
            ...candidate,
            schemaVersion: LOCAL_SCHEMA_VERSION,
            appearance: candidate.appearance || defaultBoardAppearance(candidate.board.id),
            cards: visibleCards,
            checklistsByCardId: Object.fromEntries(
              visibleCards.map((card) => [card.id, candidate.checklistsByCardId?.[card.id] || []]),
            ),
            checklistsHydratedAt: candidate.checklistsHydratedAt || null,
          };
          for (const card of snapshot.cards) {
            for (const field of CARD_FIELDS) versions[fieldKey(card.id, field)] = stamp;
            versions[fieldKey(card.id, CHECKLISTS_FIELD)] = stamp;
          }
          versions[fieldKey(snapshot.board.id, BOARD_APPEARANCE_FIELD)] = stamp;
          applied += 1;
        } else if (
          candidate.appearance
          && eventWins(versions, snapshot.board.id, BOARD_APPEARANCE_FIELD, stamp)
        ) {
          versions[fieldKey(snapshot.board.id, BOARD_APPEARANCE_FIELD)] = stamp;
          if (JSON.stringify(snapshot.appearance) !== JSON.stringify(candidate.appearance)) {
            snapshot = {
              ...snapshot,
              appearance: candidate.appearance,
              cachedAt: event.occurredAt,
            };
            applied += 1;
          }
        }
      }
      continue;
    }

    if (snapshot && event.payload.checklistDelta) {
      const result = applyChecklistDelta(
        snapshot,
        event,
        versions,
        checklistTombstones,
        checklistItemTombstones,
      );
      snapshot = result.snapshot;
      if (result.changed) applied += 1;
      continue;
    }

    if (!snapshot || event.operation !== 'card.put' || tombstones[event.entityId]) continue;
    const rawIncoming = event.payload.card as (Card & {
      status?: unknown;
      completedAt?: unknown;
    }) | undefined;
    const incomingChecklists = Array.isArray(event.payload.checklists)
      ? event.payload.checklists as Checklist[]
      : null;
    if (!rawIncoming || rawIncoming.id !== event.entityId || rawIncoming.boardId !== snapshot.board.id) {
      continue;
    }
    const incoming = stripRemovedCardState(rawIncoming);

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
      versions[fieldKey(incoming.id, field)] = stamp;
      if (next[field] !== incoming[field]) {
        Object.assign(next, { [field]: incoming[field] });
        changed = true;
      }
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
          [incoming.id]: mergeLegacyChecklists(
            snapshot.checklistsByCardId[incoming.id] || [],
            incomingChecklists || [],
          ),
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
      tombstones,
      checklistTombstones,
      checklistItemTombstones,
      lastRelayPullAt: currentState.lastRelayPullAt,
    } satisfies RoamingApplyState,
  };
}
