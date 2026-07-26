import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface NetworkContextValue {
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({ isOnline: true });

function connected(value: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
  return value.isConnected !== false && value.isInternetReachable !== false;
}

export function NetworkProvider({ children }: PropsWithChildren) {
  const [isOnline, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const next = connected(state);
      setOnline(next);
      onlineManager.setOnline(next);
    });
    void NetInfo.fetch().then((state) => {
      const next = connected(state);
      setOnline(next);
      onlineManager.setOnline(next);
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => ({ isOnline }), [isOnline]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  return useContext(NetworkContext);
}
