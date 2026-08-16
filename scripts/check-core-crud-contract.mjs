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

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const appJson = JSON.parse(read('app.json'));
if (
  packageJson.version !== '1.5.0-mobile.8'
  || packageLock.version !== packageJson.version
  || packageLock.packages?.['']?.version !== packageJson.version
  || appJson.expo.version !== '1.5.0-mobile.8'
  || appJson.expo.android.versionCode !== 8
) {
  throw new Error('Версии Android package, lock и Expo не согласованы.');
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
  "kind: 'checklist.create'",
  "kind: 'checklist.update'",
  "kind: 'checklist.delete'",
  "kind: 'checklist.item.create'",
  "kind: 'checklist.item.delete'",
  "kind: 'card.delete'",
  'replaceCreatedChecklist',
  'replaceCreatedChecklistItem',
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
  "event.operation === 'card.delete'",
  'tombstones[event.entityId]',
]);
requireText('src/features/localFirst/localVisibility.ts', [
  'applyLocalCardVisibility',
  'reconcileHiddenCardsWithCoordinator',
]);
requireText('src/features/sync/syncService.ts', [
  "appVersion: '1.5.0-mobile.8'",
]);
requireText('android/app/build.gradle', [
  'versionCode 8',
  'versionName "1.5.0-mobile.8"',
]);

console.log('OK: Android CRUD, reminders, appearance, roaming, versions and drag contract are aligned');
