import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {getOrCreateRoamingDeviceSecret, saveRoamingCapability} from './storage';
import type {RoamingCapability} from './types';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../shared/storage/storage', () => ({sessionStorageKey:(key:string)=>key}));
const mockSecure = new Map<string,string>();
jest.mock('expo-secure-store',()=>({
  getItemAsync: jest.fn(async (key:string)=>mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key:string,value:string)=>{mockSecure.set(key,value);}),
}));
beforeEach(async()=>{await AsyncStorage.clear();mockSecure.clear();jest.clearAllMocks();});
test('eight concurrent first board preparations use exactly one persisted device key',async()=>{
  let next=0; const create=jest.fn(()=>new Uint8Array(32).fill(++next));
  const keys=await Promise.all(Array.from({length:8},()=>getOrCreateRoamingDeviceSecret(create)));
  expect(create).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  for(const key of keys) expect(key).toEqual(keys[0]);
  expect(await getOrCreateRoamingDeviceSecret(create)).toEqual(keys[0]);
  expect(create).toHaveBeenCalledTimes(1);
});
test('parallel capability writes preserve every board in the cleanup index',async()=>{
  await Promise.all(['a','b','c'].map(boardId=>saveRoamingCapability({boardId,boardKey:'key'} as RoamingCapability)));
  expect(JSON.parse((await AsyncStorage.getItem('roaming/capability-index'))!)).toEqual(['a','b','c']);
});
