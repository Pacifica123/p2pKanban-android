import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { sessionStorageKey } from '../../shared/storage/storage';
import {
  EMPTY_ROAMING_APPLY_STATE,
} from './merge';
import type {
  RoamingApplyState,
  RoamingCapability,
} from './types';

const CAPABILITY_INDEX_KEY = sessionStorageKey('roaming/capability-index');
const CAPABILITY_SECRET_PREFIX = 'p2pkanban.mobile.roaming-capability.v1';
const DEVICE_SECRET_KEY = 'p2pkanban.mobile.roaming-device-key.v1';

function metadataKey(boardId: string) {
  return sessionStorageKey(`roaming/capability/${boardId}`);
}

function applyStateKey(boardId: string) {
  return sessionStorageKey(`roaming/apply-state/${boardId}`);
}

export async function saveRoamingCapability(capability: RoamingCapability) {
  const { boardKey, ...metadata } = capability;
  const rawIndex = await AsyncStorage.getItem(CAPABILITY_INDEX_KEY);
  let boardIds: string[] = [];
  try {
    boardIds = rawIndex ? JSON.parse(rawIndex) : [];
  } catch {
    boardIds = [];
  }
  await Promise.all([
    SecureStore.setItemAsync(
      `${CAPABILITY_SECRET_PREFIX}.${capability.boardId}`,
      boardKey,
    ),
    AsyncStorage.setItem(metadataKey(capability.boardId), JSON.stringify(metadata)),
    AsyncStorage.setItem(
      CAPABILITY_INDEX_KEY,
      JSON.stringify([...new Set([...boardIds, capability.boardId])]),
    ),
  ]);
}

export async function loadRoamingCapability(boardId: string) {
  const [raw, boardKey] = await Promise.all([
    AsyncStorage.getItem(metadataKey(boardId)),
    SecureStore.getItemAsync(`${CAPABILITY_SECRET_PREFIX}.${boardId}`),
  ]);
  if (!raw || !boardKey) return null;
  try {
    const metadata = JSON.parse(raw) as Partial<RoamingCapability>;
    return {
      ...metadata,
      capabilityEpoch: metadata.capabilityEpoch || 1,
      canWrite: metadata.canWrite ?? true,
      writerPublicKeys: metadata.writerPublicKeys || [],
      boardKey,
    } as RoamingCapability;
  } catch {
    return null;
  }
}

export async function loadRoamingApplyState(boardId: string) {
  const raw = await AsyncStorage.getItem(applyStateKey(boardId));
  if (!raw) return EMPTY_ROAMING_APPLY_STATE;
  try {
    return { ...EMPTY_ROAMING_APPLY_STATE, ...JSON.parse(raw) } as RoamingApplyState;
  } catch {
    return EMPTY_ROAMING_APPLY_STATE;
  }
}

export async function resetRoamingApplyState(boardId: string) {
  await AsyncStorage.removeItem(applyStateKey(boardId));
}

export async function saveRoamingApplyState(boardId: string, state: RoamingApplyState) {
  await AsyncStorage.setItem(applyStateKey(boardId), JSON.stringify(state));
}

export async function getOrCreateRoamingDeviceSecret(create: () => Uint8Array) {
  const current = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
  if (current) {
    const bytes = Uint8Array.from(current.match(/.{1,2}/g) || [], (pair) => Number.parseInt(pair, 16));
    if (bytes.length === 32) return bytes;
  }
  const created = create();
  const encoded = [...created].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DEVICE_SECRET_KEY, encoded);
  return created;
}
