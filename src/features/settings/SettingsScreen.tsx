import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useNetwork } from '../../app/NetworkProvider';
import type { RootStackParamList } from '../../app/navigation/types';
import { spacing, useAppColors } from '../../app/theme';
import {
  Button,
  InlineNotice,
  Panel,
  Screen,
  ScreenHeader,
  SectionTitle,
} from '../../shared/ui/primitives';
import { useAuth } from '../auth/AuthProvider';
import { useConnection } from '../connection/ConnectionProvider';
import { getBackendVersion } from '../../shared/api/endpoints';
import { mobileClientVersion } from '../../shared/version';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const colors = useAppColors();
  const auth = useAuth();
  const connection = useConnection();
  const { isOnline } = useNetwork();
  const [busy, setBusy] = useState(false);
  const backendVersion = useQuery({
    queryKey: ['backend-version', connection.nodeOrigin],
    queryFn: getBackendVersion,
    enabled: isOnline && Boolean(connection.nodeOrigin),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (backendVersion.data?.version) {
      void connection.rememberBackendVersion(backendVersion.data.version);
    }
  }, [backendVersion.data?.version]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOutAll() {
    Alert.alert(
      'Завершить все сеансы?',
      'Вход будет завершён на всех устройствах этого аккаунта.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Завершить',
          style: 'destructive',
          onPress: () => void run(auth.signOutEverywhere),
        },
      ],
    );
  }

  function confirmSwitchNode() {
    Alert.alert(
      'Сменить узел?',
      'Локальные снимки и неотправленные изменения текущего аккаунта будут очищены.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сменить',
          style: 'destructive',
          onPress: () => void run(async () => {
            await auth.signOut();
            await connection.disconnect();
          }),
        },
      ],
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader title="Настройки" onBack={() => navigation.goBack()} />

      {!isOnline ? (
        <InlineNotice
          text="Сейчас нет связи с узлом. Локальный выход доступен, а завершение всех сеансов — нет."
          tone="warning"
        />
      ) : null}

      <Panel style={styles.panel}>
        <SectionTitle title="Аккаунт" />
        <View style={styles.valueBlock}>
          <Text style={[styles.primaryValue, { color: colors.text }]}>
            {auth.user?.displayName}
          </Text>
          <Text style={[styles.secondaryValue, { color: colors.muted }]}>
            {auth.user?.email}
          </Text>
        </View>
        <Text style={[styles.caption, { color: colors.muted }]}>
          {auth.isOfflineSession ? 'Открыта сохранённая офлайн-сессия' : 'Сеанс подтверждён узлом'}
        </Text>
      </Panel>

      <Panel style={styles.panel}>
        <SectionTitle title="Узел" />
        <Text style={[styles.node, { color: colors.text }]} selectable>
          {connection.nodeOrigin}
        </Text>
        <Text style={[styles.caption, { color: colors.muted }]}>
          Android-клиент хранит адрес отдельно от данных аккаунта. В мобильной сети подготовленные
          доски обходят недоступный LAN-адрес и сразу используют relay.
        </Text>
        <Button label="Сменить узел" variant="danger" disabled={busy} onPress={confirmSwitchNode} />
      </Panel>

      <Panel style={styles.panel}>
        <SectionTitle title="Сеансы" />
        <Button
          label="Выйти на этом устройстве"
          disabled={busy}
          loading={busy}
          onPress={() => void run(auth.signOut)}
        />
        <Button
          label="Завершить все сеансы"
          variant="danger"
          disabled={busy || !isOnline}
          onPress={confirmSignOutAll}
        />
      </Panel>

      <Panel style={styles.panel}>
        <SectionTitle title="Версии" />
        <View style={styles.versionRow}>
          <Text style={[styles.caption, { color: colors.muted }]}>Android-клиент</Text>
          <Text style={[styles.versionValue, { color: colors.text }]} selectable>
            {mobileClientVersion}
          </Text>
        </View>
        <View style={styles.versionRow}>
          <Text style={[styles.caption, { color: colors.muted }]}>Backend подключённого узла</Text>
          <Text style={[styles.versionValue, { color: colors.text }]} selectable>
            {backendVersion.data?.version
              || connection.backendVersion
              || (backendVersion.isFetching ? 'проверяем…' : 'недоступен')}
          </Text>
        </View>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
  },
  valueBlock: {
    gap: spacing.xs,
  },
  primaryValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryValue: {
    fontSize: 14,
  },
  node: {
    fontSize: 14,
    fontFamily: 'monospace',
  },
  caption: {
    fontSize: 13,
    lineHeight: 19,
  },
  versionRow: {
    gap: spacing.xs,
  },
  versionValue: {
    fontSize: 14,
    fontFamily: 'monospace',
  },
});
