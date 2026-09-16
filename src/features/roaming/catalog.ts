import {generateSecretKey, getPublicKey, type Event} from 'nostr-tools/pure';
import type {Board} from '../../shared/types/api';
import {loadCachedBoards, saveCachedBoards} from '../../shared/storage/storage';
import {decryptPayloadParts} from '../deviceLink/protocol';
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
