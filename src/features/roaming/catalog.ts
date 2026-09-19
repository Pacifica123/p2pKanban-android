import {generateSecretKey, getPublicKey, type Event} from 'nostr-tools/pure';
import type {Board, Workspace} from '../../shared/types/api';
import {loadCachedBoards, saveCachedBoards, loadCachedWorkspaces, saveCachedWorkspaces} from '../../shared/storage/storage';
import {decryptPayloadParts, verifyChain} from '../deviceLink/protocol';
import {fetchDeviceCatalogEvents} from './nostrRelay';
import {installRoamingCapability} from './service';
import {getOrCreateRoamingDeviceSecret, loadRoamingCatalogChannel} from './storage';
import type {RoamingCapability} from './types';

export const DEVICE_CATALOG_PROTOCOL = 'p2p-kanban-device-catalog/1';
interface CatalogEnvelope {protocol:string; recipient:string; parts:string[]}
interface CatalogEntry {protocol:string;workspaceId:string;board:Board;capability:RoamingCapability;publishedAt:string}
function addressedTo(event: Event, recipient: string) {return event.tags.some(tag => tag[0] === 'p' && tag[1] === recipient);}
function validEntry(value: unknown, workspaceId: string): value is CatalogEntry {
  const item=value as Partial<CatalogEntry>;
  return item?.protocol===DEVICE_CATALOG_PROTOCOL && item.workspaceId===workspaceId
    && Boolean(item.board?.id) && item.board?.workspaceId===workspaceId
    && item.capability?.boardId===item.board?.id && item.capability?.workspaceId===workspaceId;
}
/** Recover board metadata and keys without contacting the HTTP node. */
export async function refreshDeviceCatalog(workspaceId: string) {
  const channel=await loadRoamingCatalogChannel();
  if (!channel?.relays.length || !channel.trustedPublishers.length) return loadCachedBoards(workspaceId);
  const secret=await getOrCreateRoamingDeviceSecret(generateSecretKey), recipient=getPublicKey(secret);
  const response=await fetchDeviceCatalogEvents({relays:channel.relays,kind:channel.eventKind,recipient});
  const entries=new Map<string,{entry:CatalogEntry; createdAt:number}>();
  for(const event of response.events){
    try{
      if(!addressedTo(event,recipient)||!channel.trustedPublishers.includes(event.pubkey.toLowerCase()))continue;
      const envelope=JSON.parse(event.content) as CatalogEnvelope;
      if(envelope.protocol!==DEVICE_CATALOG_PROTOCOL||envelope.recipient!==recipient||!Array.isArray(envelope.parts))continue;
      const entry=decryptPayloadParts(secret,event.pubkey,envelope.parts);
      if(!validEntry(entry,workspaceId))continue;
      const current=entries.get(entry.board.id);
      if(!current||current.createdAt<event.created_at)entries.set(entry.board.id,{entry,createdAt:event.created_at});
    }catch{/* another protocol version or incomplete relay write */}
  }
  const cached=await loadCachedBoards(workspaceId), boards=new Map(cached.map(board=>[board.id,board]));
  for(const {entry} of entries.values()){
    await installRoamingCapability(entry.capability);
    boards.set(entry.board.id,entry.board);
  }
  const result=[...boards.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  await saveCachedBoards(workspaceId,result);
  return result;
}

/** Discover entire owned workspaces from signed, encrypted catalogs. */
export async function refreshWorkspaceCatalog(userId: string): Promise<Workspace[]> {
  const cached = await loadCachedWorkspaces();
  const channel = await loadRoamingCatalogChannel();
  if (!channel?.relays.length || !channel.trustedPublishers.length) return cached;
  const secret = await getOrCreateRoamingDeviceSecret(generateSecretKey), recipient = getPublicKey(secret);
  const response = await fetchDeviceCatalogEvents({relays:channel.relays,kind:channel.eventKind,recipient});
  const workspaces = new Map(cached.map(workspace => [workspace.id,workspace]));
  const boards = new Map<string, Map<string,Board>>();
  for (const event of response.events) {
    try {
      if (!addressedTo(event,recipient)) continue;
      const envelope=JSON.parse(event.content) as CatalogEnvelope;
      if(envelope.protocol!==DEVICE_CATALOG_PROTOCOL||envelope.recipient!==recipient||!Array.isArray(envelope.parts))continue;
      const entry=decryptPayloadParts(secret,event.pubkey,envelope.parts) as CatalogEntry & {
        workspace?:{id:string;name:string;description?:string|null;visibility:string};
        introductionChain?:Event[];
      };
      if (!validEntry(entry,entry.workspaceId) || !entry.workspace ||
        entry.workspace.id!==entry.workspaceId || !entry.workspace.name?.trim() ||
        !['private','shared'].includes(entry.workspace.visibility)) continue;
      const trusted=channel.trustedPublishers.includes(event.pubkey.toLowerCase());
      if (!trusted) {
        const intro=verifyChain(entry.introductionChain || [],event.pubkey);
        if (!channel.trustedPublishers.includes(intro.root.toLowerCase()) ||
          intro.grant.userId!==userId || !intro.grant.canDelegate) continue;
      }
      const delegation=verifyChain(entry.capability.delegationChain || [],recipient);
      if(delegation.grant.userId!==userId || delegation.grant.boardId!==entry.board.id ||
        delegation.grant.workspaceId!==entry.workspaceId ||
        delegation.grant.epoch!==entry.capability.capabilityEpoch) continue;
      await installRoamingCapability(entry.capability);
      const old = workspaces.get(entry.workspaceId);
      if (!old) workspaces.set(entry.workspaceId, {
        id:entry.workspaceId,name:entry.workspace.name,description:entry.workspace.description || null,
        visibility:entry.workspace.visibility as Workspace['visibility'],ownerUserId:userId,
        currentUserRole:'owner',isArchived:false,createdAt:entry.publishedAt,
        updatedAt:entry.publishedAt,accessEpoch:entry.capability.capabilityEpoch,
      });
      const group=boards.get(entry.workspaceId)||new Map<string,Board>();
      group.set(entry.board.id,entry.board);boards.set(entry.workspaceId,group);
    } catch { /* malformed or stale catalog cannot change the local replica */ }
  }
  for (const [workspaceId, entries] of boards) {
    const existing=await loadCachedBoards(workspaceId);
    await saveCachedBoards(workspaceId,[...new Map([...existing,...entries.values()].map(board=>[board.id,board])).values()]);
  }
  const result=[...workspaces.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  await saveCachedWorkspaces(result);
  return result;
}
