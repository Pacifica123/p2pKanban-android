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
  packageJson.version !== '1.4.0-mobile.5'
  || packageLock.version !== packageJson.version
  || packageLock.packages?.['']?.version !== packageJson.version
  || appJson.expo.version !== '1.4.0'
  || appJson.expo.android.versionCode !== 5
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
]);
requireText('src/features/roaming/service.ts', [
  "return ['checklists']",
  'operationCardId(operation)',
]);
requireText('src/features/boards/BoardScreen.tsx', [
  'PanResponder.create',
  'getDropColumnIndex',
  'getEdgeScrollOffset',
  'getAppendPosition',
  'runtime.moveCard',
]);
requireText('src/features/cards/CardDetailsModal.tsx', [
  'runtime.createChecklist',
  'runtime.updateChecklist',
  'runtime.deleteChecklist',
  'replaceCardLabels',
  'createBoardLabel',
  'createComment',
]);

console.log('OK: Android CRUD, coordinator-first fallback, roaming checklists and drag contract are aligned');
