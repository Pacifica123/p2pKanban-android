import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNetwork } from '../../app/NetworkProvider';
import type { RootStackParamList } from '../../app/navigation/types';
import { radius, spacing, useAppColors } from '../../app/theme';
import { createWorkspace, getWorkspaces } from '../../shared/api/endpoints';
import {
  loadCachedWorkspaces,
  saveCachedWorkspaces,
} from '../../shared/storage/storage';
import type { Workspace } from '../../shared/types/api';
import {
  Button,
  Field,
  FormModal,
  InlineNotice,
  Screen,
  ScreenHeader,
  StateView,
} from '../../shared/ui/primitives';
import { useAuth } from '../auth/AuthProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Workspaces'>;

export function WorkspacesScreen({ navigation }: Props) {
  const colors = useAppColors();
  const { isOnline } = useNetwork();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [cached, setCached] = useState<Workspace[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void loadCachedWorkspaces().then(setCached);
  }, []);

  const query = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const response = await getWorkspaces();
      await saveCachedWorkspaces(response.items);
      setCached(response.items);
      return response;
    },
    enabled: isOnline,
  });

  const createMutation = useMutation({
    mutationFn: () => createWorkspace({
      name: name.trim(),
      description: description.trim() || undefined,
      visibility: 'private',
    }),
    onSuccess: async () => {
      setModalVisible(false);
      setName('');
      setDescription('');
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Не удалось создать пространство.'),
  });

  const items = query.data?.items ?? cached;

  return (
    <Screen scroll contentStyle={styles.screen}>
      <ScreenHeader
        title="Пространства"
        subtitle={auth.isOfflineSession ? 'Офлайн-копия' : auth.user?.displayName}
        action={(
          <Button
            label="Настройки"
            compact
            variant="ghost"
            onPress={() => navigation.navigate('Settings')}
          />
        )}
      />

      {!isOnline ? (
        <InlineNotice
          text="Нет связи с узлом. Доступны сохранённые пространства и доски."
          tone="warning"
        />
      ) : null}

      <View style={styles.toolbar}>
        <Text style={[styles.summary, { color: colors.muted }]}>
          {items.length} {items.length === 1 ? 'пространство' : 'пространств'}
        </Text>
        <Button
          label="Создать"
          compact
          variant="primary"
          disabled={!isOnline}
          onPress={() => setModalVisible(true)}
        />
      </View>

      {query.isPending && !items.length ? (
        <StateView title="Загружаем пространства" busy />
      ) : null}

      {query.isError && !items.length ? (
        <StateView
          title="Пространства недоступны"
          description={query.error instanceof Error ? query.error.message : 'Не удалось получить данные.'}
          action={<Button label="Повторить" onPress={() => void query.refetch()} />}
        />
      ) : null}

      {!query.isPending && !items.length ? (
        <StateView
          title="Пока пусто"
          description={isOnline
            ? 'Создайте первое пространство для досок.'
            : 'Подключитесь к узлу, чтобы создать первое пространство.'}
          action={isOnline
            ? <Button label="Создать пространство" variant="primary" onPress={() => setModalVisible(true)} />
            : undefined}
        />
      ) : null}

      <View style={styles.list}>
        {items.map((workspace) => (
          <Pressable
            key={workspace.id}
            onPress={() => navigation.navigate('Boards', {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            })}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{workspace.name}</Text>
              <Text style={[styles.rowDescription, { color: colors.muted }]} numberOfLines={2}>
                {workspace.description || (workspace.visibility === 'private' ? 'Личное пространство' : 'Общее пространство')}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
          </Pressable>
        ))}
      </View>

      <FormModal
        visible={modalVisible}
        title="Новое пространство"
        onClose={() => {
          if (!createMutation.isPending) setModalVisible(false);
        }}
      >
        <Field
          label="Название"
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Например, p2pKanban"
        />
        <Field
          label="Описание"
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="Необязательно"
        />
        {formError ? <InlineNotice text={formError} tone="danger" /> : null}
        <Button
          label="Создать"
          variant="primary"
          loading={createMutation.isPending}
          disabled={!name.trim()}
          onPress={() => createMutation.mutate()}
        />
      </FormModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing.xl,
  },
  toolbar: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summary: {
    fontSize: 13,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  rowDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    fontSize: 28,
    paddingLeft: spacing.sm,
  },
});
