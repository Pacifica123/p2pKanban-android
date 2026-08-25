import type { Board } from '../../shared/types/api';
import {
  loadBoardSnapshot,
  loadOperationQueue,
  persistServerSnapshot,
} from '../localFirst/repository';
import { fetchBoardSnapshot } from '../localFirst/snapshot';
import {
  installRoamingCapability,
  getRoamingAuthorPublicKey,
  loadRoamingCapability,
  publishBoardSnapshot,
} from './service';
import { provisionRoamingBoard } from '../../shared/api/endpoints';

export interface PrimeBoardsResult {
  ready: number;
  prepared: number;
  failed: number;
}

async function primeBoard(workspaceId: string, board: Board) {
  const [local, storedCapability] = await Promise.all([
    loadBoardSnapshot(board.id),
    loadRoamingCapability(board.id),
  ]);
  const authorPublicKey = await getRoamingAuthorPublicKey();
  const provisioned = await provisionRoamingBoard(board.id, authorPublicKey);
  const capability = storedCapability?.capabilityEpoch === provisioned.capabilityEpoch
    && storedCapability.boardTag === provisioned.boardTag
    ? { ...provisioned, boardKey: storedCapability.boardKey }
    : provisioned;
  await installRoamingCapability(capability);
  if (local?.checklistsHydratedAt) return 'ready' as const;

  const [snapshot, operations] = await Promise.all([
    fetchBoardSnapshot(board.id, workspaceId),
    loadOperationQueue(),
  ]);
  const merged = await persistServerSnapshot(snapshot, operations);
  if (capability.canWrite) await publishBoardSnapshot(capability, merged);
  return 'prepared' as const;
}

export async function primeWorkspaceBoards(
  workspaceId: string,
  boards: Board[],
): Promise<PrimeBoardsResult> {
  const result: PrimeBoardsResult = { ready: 0, prepared: 0, failed: 0 };
  for (let index = 0; index < boards.length; index += 2) {
    const batch = boards.slice(index, index + 2);
    const settled = await Promise.allSettled(
      batch.map((board) => primeBoard(workspaceId, board)),
    );
    for (const item of settled) {
      if (item.status === 'rejected') result.failed += 1;
      else result[item.value] += 1;
    }
  }
  return result;
}
