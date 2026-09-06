import {
  finalizeEvent,
  getPublicKey,
  generateSecretKey,
  type Event,
} from 'nostr-tools/pure';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { apiRequest } from '../../shared/api/client';
import {
  readSessionJson,
  writeSessionJson,
} from '../../shared/storage/storage';
import {
  getOrCreateRoamingDeviceSecret,
  loadRoamingApplyState,
  loadRoamingCapability,
} from '../roaming/storage';
import {
  loadBoardSnapshot,
  loadOperationQueue,
} from '../localFirst/repository';
import { overlayBoard } from './snapshot';
import {
  checkRequest,
  decryptPack,
  encryptPack,
  extendChain,
  LINK_PROTOCOL,
  RESPONSE_KIND,
  verifyChain,
} from './protocol';
const CACHE = 'device-link/prepared';
const secret = () => getOrCreateRoamingDeviceSecret(generateSecretKey);
export async function prepareDeviceLink() {
  const k = await secret();
  const response = await apiRequest<Event>(
    '/auth/device-link/prepare',
    {
      method: 'POST',
      body: JSON.stringify({ authorPublicKey: getPublicKey(k) }),
    },
    { timeoutMs: 30000 },
  );
  const data = decryptPack(k, response);
  for (const c of Object.values(data.chains))
    verifyChain(c as Event[], getPublicKey(k));
  await writeSessionJson(CACHE, response);
  return data.snapshot.exportedAt as string;
}
export async function preparationInfo() {
  const cached = await readSessionJson<Event | null>(CACHE, null);
  if (!cached) return null;
  const k = await secret(),
    data = decryptPack(k, cached),
    grants = Object.values(data.chains).map((c) =>
      verifyChain(c as Event[], getPublicKey(k)),
    );
  return {
    exportedAt: data.snapshot.exportedAt as string,
    boards: grants.length,
    expiresAt: Math.min(...grants.map((g) => g.grant.expiresAt)),
  };
}
export async function deviceFingerprint() {
  return getPublicKey(await secret());
}
export async function approveDevice(raw: string, userId: string) {
  if (raw.length > 10000) throw new Error('Слишком большой запрос.');
  const request = JSON.parse(raw) as Event,
    { recipient, id, expiresAt } = checkRequest(request),
    k = await secret();
  const saved = await readSessionJson<Event | null>(
    `device-link/issued/${id}`,
    null,
  );
  if (saved) return shareApproval(saved);
  const cached = await readSessionJson<Event | null>(CACHE, null);
  if (!cached)
    throw new Error(
      'Сначала подготовьте подключение при доступном исходном узле.',
    );
  const data = decryptPack(k, cached);
  if (data.snapshot.user.id !== userId)
    throw new Error('Снимок принадлежит другому аккаунту.');
  for (const [boardId, rawChain] of Object.entries(data.chains)) {
    const chain = rawChain as Event[],
      { grant } = verifyChain(chain, getPublicKey(k)),
      current = await loadRoamingCapability(boardId);
    if (
      current &&
      (current.capabilityEpoch !== grant.epoch || !current.canWrite)
    )
      throw new Error('Права изменились; обновите подготовку.');
    data.chains[boardId] = extendChain(k, chain, recipient);
    const local = await loadBoardSnapshot(boardId);
    if (!local) continue;
    const workspace = data.snapshot.workspaces.find(
      (w: any) => w.bundle['manifest.json'].workspaceId === grant.workspaceId,
    );
    if (!workspace) throw new Error('Scope снимка повреждён.');
    const state = await loadRoamingApplyState(boardId),
      operations = await loadOperationQueue();
    const deleted = new Set([
      ...Object.keys(state.tombstones),
      ...operations
        .filter((op) => op.boardId === boardId && op.kind === 'card.delete')
        .map((op) => op.entityId),
    ]);
    overlayBoard(workspace.bundle.payload, local, deleted);
    for (const cardId of deleted)
      if (!data.snapshot.cardTombstones.some((t: any) => t.cardId === cardId))
        data.snapshot.cardTombstones.push({
          workspaceId: grant.workspaceId,
          boardId,
          cardId,
          deletedAt: new Date().toISOString(),
        });
  }
  const response = finalizeEvent(
    {
      kind: RESPONSE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        protocol: LINK_PROTOCOL,
        recipient,
        requestId: id,
        expiresAt,
        parts: encryptPack(k, recipient, data),
      }),
    },
    k,
  );
  await writeSessionJson(`device-link/issued/${id}`, response);
  await shareApproval(response);
}
async function shareApproval(e: Event) {
  const f = new File(
    Paths.cache,
    `p2pkanban-pairing-${e.id.slice(0, 12)}.json`,
  );
  f.write(JSON.stringify(e));
  await Sharing.shareAsync(f.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Передать зашифрованное разрешение ноутбуку',
  });
}
