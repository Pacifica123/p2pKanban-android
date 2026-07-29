import type {
  ActivityListResponse,
  Board,
  BoardColumn,
  BoardListResponse,
  Card,
  CardListResponse,
  ChecklistItem,
  ChecklistListResponse,
  ColumnListResponse,
  NativeAuthSuccessResponse,
  Replica,
  RoamingCapabilityResponse,
  SessionResponse,
  SyncStatusResponse,
  Workspace,
  WorkspaceListResponse,
} from '../types/api';
import { apiRequest } from './client';

export function nativeSignIn(input: { email: string; password: string }) {
  return apiRequest<NativeAuthSuccessResponse>(
    '/auth/native/sign-in',
    { method: 'POST', body: JSON.stringify(input) },
    { skipRefresh: true },
  );
}

export function nativeSignUp(input: { email: string; password: string; displayName: string }) {
  return apiRequest<NativeAuthSuccessResponse>(
    '/auth/native/sign-up',
    { method: 'POST', body: JSON.stringify(input) },
    { skipRefresh: true },
  );
}

export function nativeRefresh(refreshToken: string) {
  return apiRequest<NativeAuthSuccessResponse>(
    '/auth/native/refresh',
    { method: 'POST', body: JSON.stringify({ refreshToken }) },
    { skipRefresh: true },
  );
}

export function nativeSignOut(refreshToken: string) {
  return apiRequest<{ signedOut: boolean; mode: string }>(
    '/auth/native/sign-out',
    { method: 'POST', body: JSON.stringify({ refreshToken }) },
    { skipRefresh: true },
  );
}

export function signOutAll() {
  return apiRequest<{ signedOut: boolean; mode: string }>('/auth/sign-out-all', {
    method: 'POST',
  });
}

export function getSession() {
  return apiRequest<SessionResponse>('/auth/session');
}

export function getWorkspaces() {
  return apiRequest<WorkspaceListResponse>('/workspaces');
}

export function createWorkspace(input: {
  name: string;
  visibility: 'private' | 'shared';
  description?: string;
}) {
  return apiRequest<Workspace>('/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getBoards(workspaceId: string) {
  return apiRequest<BoardListResponse>(`/workspaces/${workspaceId}/boards`);
}

export function createBoard(workspaceId: string, input: { name: string; description?: string }) {
  return apiRequest<Board>(`/workspaces/${workspaceId}/boards`, {
    method: 'POST',
    body: JSON.stringify({ ...input, boardType: 'kanban' }),
  });
}

export function getBoard(boardId: string) {
  return apiRequest<Board>(`/boards/${boardId}`);
}

export function getColumns(boardId: string) {
  return apiRequest<ColumnListResponse>(`/boards/${boardId}/columns`);
}

export function createColumn(boardId: string, input: { name: string; position?: number }) {
  return apiRequest<BoardColumn>(`/boards/${boardId}/columns`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCards(boardId: string) {
  return apiRequest<CardListResponse>(`/boards/${boardId}/cards`);
}

export function getChecklists(cardId: string) {
  return apiRequest<ChecklistListResponse>(`/cards/${cardId}/checklists`);
}

export function updateChecklistItem(
  itemId: string,
  input: { isDone: boolean },
) {
  return apiRequest<ChecklistItem>(`/checklist-items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createCard(boardId: string, input: {
  title: string;
  description?: string;
  columnId: string;
  status?: Card['status'];
  priority?: Card['priority'];
}) {
  return apiRequest<Card>(`/boards/${boardId}/cards`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCard(cardId: string, input: Partial<Pick<
  Card,
  'title' | 'description' | 'status' | 'priority' | 'startAt' | 'dueAt' | 'completedAt'
>>) {
  return apiRequest<Card>(`/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function moveCard(cardId: string, input: { targetColumnId: string; position?: number | null }) {
  return apiRequest<Card>(`/cards/${cardId}/move`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function archiveCard(cardId: string) {
  return apiRequest<Card>(`/cards/${cardId}/archive`, { method: 'POST' });
}

export function getBoardActivity(boardId: string) {
  return apiRequest<ActivityListResponse>(`/boards/${boardId}/activity?limit=60`);
}

export function registerReplica(input: {
  replicaKey: string;
  displayName: string;
  platform: string;
  appVersion: string;
}) {
  return apiRequest<{ replica: Replica }>('/sync/replicas', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      kind: 'device',
      protocolVersion: 'sync-baseline-v1',
      metadata: { shell: 'react-native-expo' },
    }),
  });
}

export function getSyncStatus(replicaId: string) {
  return apiRequest<SyncStatusResponse>(`/sync/status?replicaId=${encodeURIComponent(replicaId)}`);
}

export function pullWorkspace(input: {
  replicaId: string;
  workspaceId: string;
  lastServerOrder: number;
}) {
  const query = new URLSearchParams({
    replicaId: input.replicaId,
    scope: 'workspace',
    workspaceId: input.workspaceId,
    lastServerOrder: String(input.lastServerOrder),
    limit: '100',
  });
  return apiRequest<{
    events: unknown[];
    nextCursor: {
      scope: { scope: 'workspace'; workspaceId: string };
      replicaId: string;
      lastServerOrder: number;
    };
    hasMore: boolean;
  }>(`/sync/pull?${query.toString()}`);
}

export function provisionRoamingBoard(boardId: string) {
  return apiRequest<RoamingCapabilityResponse>(
    '/sync/roaming/capability',
    {
      method: 'POST',
      body: JSON.stringify({ boardId }),
    },
  );
}
