import type { Event as NostrEvent, Filter } from 'nostr-tools';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';

const RELAY_TIMEOUT_MS = 8_000;

function withRelay<T>(
  url: string,
  run: (socket: WebSocket, finish: (value: T) => void, fail: (reason: unknown) => void) => void,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(reason instanceof Error ? reason : new Error(`Релей ${url} недоступен.`));
    };
    const timer = setTimeout(() => fail(new Error(`Релей ${url} не ответил вовремя.`)), RELAY_TIMEOUT_MS);
    socket.onerror = () => fail(new Error(`Не удалось открыть ${url}.`));
    socket.onopen = () => {
      try {
        run(socket, finish, fail);
      } catch (error) {
        fail(error);
      }
    };
  });
}

async function publishOne(url: string, event: NostrEvent) {
  return withRelay<string>(url, (socket, finish, fail) => {
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data)) as unknown[];
        if (frame[0] !== 'OK' || frame[1] !== event.id) return;
        if (frame[2] === true) finish(url);
        else fail(new Error(String(frame[3] || `Релей ${url} отклонил событие.`)));
      } catch (error) {
        fail(error);
      }
    };
    socket.send(JSON.stringify(['EVENT', event]));
  });
}

async function fetchOne(url: string, filter: Filter) {
  return withRelay<NostrEvent[]>(url, (socket, finish, fail) => {
    const subscriptionId = `p2pk-${Math.random().toString(36).slice(2)}`;
    const events: NostrEvent[] = [];
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data)) as unknown[];
        if (frame[0] === 'EVENT' && frame[1] === subscriptionId) {
          const event = frame[2] as NostrEvent;
          if (verifyEvent(event)) events.push(event);
        }
        if (frame[0] === 'EOSE' && frame[1] === subscriptionId) {
          socket.send(JSON.stringify(['CLOSE', subscriptionId]));
          finish(events);
        }
      } catch (error) {
        fail(error);
      }
    };
    socket.send(JSON.stringify(['REQ', subscriptionId, filter]));
  });
}

export function createSignedNostrEvent(input: {
  secretKey: Uint8Array;
  kind: number;
  boardTag: string;
  content: string;
  createdAt?: number;
}) {
  return finalizeEvent({
    kind: input.kind,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ['d', input.boardTag],
      ['t', 'p2pkanban-roaming'],
      ['v', '1'],
    ],
    content: input.content,
  }, input.secretKey);
}

export async function publishToRelays(
  relays: string[],
  event: NostrEvent,
  minimumAcks: number,
) {
  const settled = await Promise.allSettled(relays.map((relay) => publishOne(relay, event)));
  const acceptedRelays = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failedRelays = relays.filter((relay) => !acceptedRelays.includes(relay));
  if (acceptedRelays.length < Math.min(minimumAcks, relays.length)) {
    throw new Error(
      `Журнал принят только ${acceptedRelays.length} из ${Math.min(minimumAcks, relays.length)} нужных релеев.`,
    );
  }
  return { acceptedRelays, failedRelays };
}

export async function fetchFromRelays(input: {
  relays: string[];
  kind: number;
  boardTag: string;
}) {
  const filter: Filter = {
    kinds: [input.kind],
    '#d': [input.boardTag],
  };
  const settled = await Promise.allSettled(input.relays.map((relay) => fetchOne(relay, filter)));
  const eventsById = new Map<string, NostrEvent>();
  let relayCount = 0;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    relayCount += 1;
    for (const event of result.value) eventsById.set(event.id, event);
  }
  if (!relayCount) throw new Error('Ни один релей доски не ответил.');
  return { events: [...eventsById.values()], relayCount };
}
