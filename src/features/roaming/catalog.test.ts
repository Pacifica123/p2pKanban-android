import type {Event} from 'nostr-tools/pure';
import {refreshDeviceCatalog} from './catalog';
import {decryptPayloadParts} from '../deviceLink/protocol';
import {fetchDeviceCatalogEvents} from './nostrRelay';
import {installRoamingCapability} from './service';
import {saveCachedBoards} from '../../shared/storage/storage';

const board={id:'board',workspaceId:'workspace',name:'Relay board',boardType:'kanban',isArchived:false,createdAt:'2026-01-01',updatedAt:'2026-01-01'};
const capability={formatVersion:1,protocolVersion:'p2p-kanban-roaming/1',workspaceId:'workspace',boardId:'board',boardTag:'tag',boardKey:'key',capabilityEpoch:1,canWrite:true,writerPublicKeys:['trusted'],relays:['wss://relay'],eventKind:30101,minimumRelayAcks:1,provisionedAt:'2026-01-01'};

jest.mock('./nostrRelay',()=>({fetchDeviceCatalogEvents:jest.fn()}));
jest.mock('./service',()=>({installRoamingCapability:jest.fn()}));
jest.mock('../deviceLink/protocol',()=>({decryptPayloadParts:jest.fn()}));
jest.mock('./storage',()=>({
  getOrCreateRoamingDeviceSecret:async()=>new Uint8Array(32).fill(1),
  loadRoamingCatalogChannel:async()=>({relays:['wss://relay'],eventKind:30102,trustedPublishers:['trusted']}),
}));
jest.mock('../../shared/storage/storage',()=>({
  loadCachedBoards:jest.fn(async()=>[]),
  saveCachedBoards:jest.fn(),
}));

function event(pubkey:string,parts:string[],created_at=1):Event{return {
  id:parts.join('-'),pubkey,created_at,kind:30102,
  tags:[['p','1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f']],
  content:JSON.stringify({protocol:'p2p-kanban-device-catalog/1',recipient:'1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f',parts}),sig:'sig',
};}

test('restores a missing board and capability from a trusted direct relay catalog',async()=>{
  (fetchDeviceCatalogEvents as jest.Mock).mockResolvedValue({relayCount:1,events:[event('untrusted',['bad']),event('trusted',['good'],2)]});
  (decryptPayloadParts as jest.Mock).mockReturnValue({protocol:'p2p-kanban-device-catalog/1',workspaceId:'workspace',board,capability,publishedAt:'2026-01-01'});
  await expect(refreshDeviceCatalog('workspace')).resolves.toEqual([board]);
  expect(decryptPayloadParts).toHaveBeenCalledTimes(1);
  expect(installRoamingCapability).toHaveBeenCalledWith(capability);
  expect(saveCachedBoards).toHaveBeenCalledWith('workspace',[board]);
});
