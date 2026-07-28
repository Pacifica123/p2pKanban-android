export interface PageInfo {
  nextCursor?: string | null;
  hasNextPage?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface NativeAuthSuccessResponse {
  authenticated: true;
  mode: 'native_refresh_token_plus_bearer' | string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string;
  user: AuthUser;
}

export interface SessionResponse {
  authenticated: boolean;
  mode: string;
  sessionId: string | null;
  deviceId: string | null;
  user: AuthUser | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  visibility: 'private' | 'shared';
  ownerUserId: string;
  memberCount?: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface WorkspaceListResponse {
  items: Workspace[];
  pageInfo: PageInfo;
}

export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  boardType: 'kanban';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface BoardListResponse {
  items: Board[];
  pageInfo: PageInfo;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  description?: string | null;
  position: number;
  colorToken?: string | null;
  wipLimit?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnListResponse {
  items: BoardColumn[];
}

export type CardStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | null;

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent' | null;

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  parentCardId?: string | null;
  title: string;
  description?: string | null;
  status: CardStatus;
  priority: CardPriority;
  position: number;
  startAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  isArchived: boolean;
  labelIds?: string[];
  checklistCount?: number;
  checklistCompletedItemCount?: number;
  commentCount?: number;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface CardListResponse {
  items: Card[];
  pageInfo: PageInfo;
}

export interface ActivityActor {
  userId: string | null;
  displayName: string | null;
}

export interface ActivityEntry {
  id: string;
  createdAt: string;
  kind: string;
  boardId: string;
  cardId: string | null;
  entityType: string;
  entityId: string;
  actor: ActivityActor;
  fieldMask: string[];
}

export interface ActivityListResponse {
  items: ActivityEntry[];
  nextCursor: string | null;
}

export interface Replica {
  id: string;
  replicaKey?: string | null;
  kind: string;
  status: 'active' | 'disabled';
  displayName?: string | null;
  platform?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncStatusResponse {
  healthy: boolean;
  mode: string;
  serverTime: string;
  maxServerOrder?: number | null;
  replica?: Replica | null;
}

export interface RoamingCapabilityResponse {
  formatVersion: 1;
  protocolVersion: 'p2p-kanban-roaming/1';
  workspaceId: string;
  boardId: string;
  boardTag: string;
  boardKey: string;
  relays: string[];
  eventKind: number;
  minimumRelayAcks: number;
  provisionedAt: string;
}
