import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function read(relative) {
  return readFileSync(resolve(root, relative), 'utf8');
}

function requireText(relative, needles) {
  const content = read(relative);
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length) {
    throw new Error(`${relative}: отсутствуют ${missing.join(', ')}`);
  }
}

function forbidText(relative, needles) {
  const content = read(relative);
  const present = needles.filter((needle) => content.includes(needle));
  if (present.length) {
    throw new Error(`${relative}: запрещённые фрагменты ${present.join(', ')}`);
  }
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const appJson = JSON.parse(read('app.json'));
if (
  packageJson.version !== '1.5.0-mobile.9'
  || packageLock.version !== packageJson.version
  || packageLock.packages?.['']?.version !== packageJson.version
  || appJson.expo.version !== '1.5.0-mobile.9'
  || appJson.expo.android.versionCode !== 9
) {
  throw new Error('Версии Android package, lock и Expo не согласованы.');
}

const cardContract = read('src/shared/types/api.ts')
  .match(/export interface Card \{([\s\S]*?)\n\}/)?.[1];
if (!cardContract || /\bstatus\??:|\bcompletedAt\??:/.test(cardContract)) {
  throw new Error('Card-контракт всё ещё содержит фиксированное состояние.');
}
const cardEndpoints = read('src/shared/api/endpoints.ts').split('export function getCards', 2)[1]
  ?.split('export function getBoardLabels', 1)[0];
if (!cardEndpoints || /\bstatus\b|completedAt/.test(cardEndpoints)) {
  throw new Error('Card endpoints всё ещё передают фиксированное состояние.');
}

requireText('src/shared/api/endpoints.ts', [
  'updateWorkspace',
  'deleteWorkspace',
  'updateBoard',
  'deleteBoard',
  'updateColumn',
  'deleteColumn',
  'createChecklistItem',
  'deleteChecklistItem',
  'replaceCardLabels',
  'createComment',
  'deleteComment',
]);
requireText('src/features/localFirst/model.ts', [
  "kind: 'board.appearance.update'",
  "kind: 'checklist.create'",
  "kind: 'checklist.update'",
  "kind: 'checklist.delete'",
  "kind: 'checklist.item.create'",
  "kind: 'checklist.item.delete'",
  "kind: 'card.delete'",
  'replaceCreatedChecklist',
  'replaceCreatedChecklistItem',
  'mergeBoardSnapshots',
  'checklistsHydratedAt',
  'checklistTombstones',
  'checklistItemTombstones',
]);
requireText('src/features/localFirst/useLocalBoard.ts', [
  'const publishFallback',
  'createCardRemote',
  'coordinatorUnavailable(error)',
  'publishLocalOperation(',
  'createChecklistItemRemote',
  'deleteChecklistItemRemote',
  'hideCardOnThisDevice',
  'restoreCardOnThisDevice',
]);
requireText('src/features/roaming/service.ts', [
  "operation: 'board.appearance.put'",
  "return ['checklists']",
  'operationCardId(operation)',
  "operation: 'card.delete'",
]);
requireText('src/features/boards/BoardScreen.tsx', [
  'PanResponder.create',
  'getDropColumnIndex',
  'getEdgeScrollOffset',
  'getAppendPosition',
  'runtime.moveCard',
  'runtime.locallyHiddenCards',
  'BoardAppearanceModal',
  'resolveBoardPalette',
]);
requireText('src/features/cards/CardDetailsModal.tsx', [
  'PriorityStars',
  'columnName',
  'runtime.createChecklist',
  'runtime.updateChecklist',
  'runtime.deleteChecklist',
  'replaceCardLabels',
  'createBoardLabel',
  'createComment',
  'runtime.hideCardLocally',
  'Удалить везде',
  'scheduleCardReminder',
  'cancelCardReminder',
]);
forbidText('src/features/cards/CardDetailsModal.tsx', [
  'CardStatus',
  'setStatus(',
  'statusOptions',
]);
requireText('src/features/boards/BoardScreen.tsx', [
  'ColorOverrideProvider',
  'runtime.updateAppearance',
]);

requireText('src/features/reminders/service.ts', [
  'SchedulableTriggerInputTypes.DATE',
  'timezoneOffset',
  'reconcileCardReminders',
  'cancelAllCardReminders',
]);
requireText('src/features/appearance/AppearanceProvider.tsx', [
  'getMyAppearance',
  'updateMyAppearance',
  'PENDING_KEY',
]);
requireText('app.json', [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'expo-notifications',
]);
requireText('android/app/src/main/AndroidManifest.xml', [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
]);

requireText('src/features/roaming/merge.ts', [
  "event.operation === 'board.appearance.put'",
  "event.operation === 'card.delete'",
  'tombstones[event.entityId]',
]);
requireText('src/features/localFirst/localVisibility.ts', [
  'applyLocalCardVisibility',
  'reconcileHiddenCardsWithCoordinator',
]);
requireText('src/features/sync/syncService.ts', [
  "appVersion: '1.5.0-mobile.9'",
]);
requireText('android/app/build.gradle', [
  'versionCode 9',
  'versionName "1.5.0-mobile.9"',
]);

console.log('OK: Android CRUD, reminders, appearance, roaming, versions and drag contract are aligned');
