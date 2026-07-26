import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { setApiNodeOrigin } from '../../shared/api/client';
import {
  clearSessionBoundStorage,
  forgetNodeOrigin,
  loadNodeOrigin,
  saveNodeOrigin,
} from '../../shared/storage/storage';
import { normalizeNodeOrigin, probeNode } from './connection';

interface ConnectionContextValue {
  status: 'loading' | 'ready';
  nodeOrigin: string | null;
  connect: (input: string) => Promise<string>;
  disconnect: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [nodeOrigin, setNodeOrigin] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadNodeOrigin()
      .then((stored) => {
        if (!active) return;
        setApiNodeOrigin(stored);
        setNodeOrigin(stored);
      })
      .finally(() => {
        if (active) setStatus('ready');
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      status,
      nodeOrigin,
      connect: async (input) => {
        const normalized = normalizeNodeOrigin(input);
        await probeNode(normalized);
        if (nodeOrigin && nodeOrigin !== normalized) {
          await clearSessionBoundStorage();
        }
        await saveNodeOrigin(normalized);
        setApiNodeOrigin(normalized);
        setNodeOrigin(normalized);
        return normalized;
      },
      disconnect: async () => {
        await clearSessionBoundStorage();
        await forgetNodeOrigin();
        setApiNodeOrigin(null);
        setNodeOrigin(null);
      },
    }),
    [nodeOrigin, status],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection() {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error('useConnection must be used inside ConnectionProvider');
  return value;
}
