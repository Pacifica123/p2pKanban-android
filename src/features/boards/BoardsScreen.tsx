import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNetwork } from '../../app/NetworkProvider';
import type { RootStackParamList } from '../../app/navigation/types';
import { radius, spacing, useAppColors } from '../../app/theme';
import { createBoard, getBoards } from '../../shared/api/endpoints';
import {
  loadCachedBoards,
  saveCachedBoards,
} from '../../shared/storage/storage';
import type { Board } from '../../shared/types/api';
import {
  Button,
  Field,
  FormModal,
  InlineNotice,
  Screen,
  ScreenHeader,
  StateView,
} from '../../shared/ui/primitives';
import {
  primeWorkspaceBoards,
  type PrimeBoardsResult,
} from '../roaming/primeBoards';

type Props = NativeStackScreenProps<RootStackParamList, 'Boards'>;

export function BoardsScreen({ navigation, route }: Props) {
  const { workspaceId, workspaceName } = route.params;
  const colors = useAppColors();
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [cached, setCached] = useState<Board[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [primeState, setPrimeState] = useState<
    { status: 'idle' | 'running' | 'done'; result: PrimeBoardsResult | null }
  >({ status: 'idle', result: null });

  useEffect(() => {
    void loadCachedBoards(workspaceId).then(setCached);
  }, [workspaceId]);

  const query = useQuery({
    queryKey: ['boards', workspaceId],
    queryFn: async () => {
      const response = await getBoards(workspaceId);
      await saveCachedBoards(workspaceId, response.items);
      setCached(response.items);
      return response;
    },
    enabled: isOnline,
  });

  const createMutation = useMutation({
    mutationFn: () => createBoard(workspaceId, {
      name: name.trim(),
      description: description.trim() || undefined,
    }),
    onSuccess: async () => {
      setModalVisible(false);
      setName('');
      setDescription('');
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['boards', workspaceId] });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Не удалось создать доску.'),
  });

  const items = query.data?.items ?? cached;
  const boardIds = items.map((board) => board.id).join('|');

  useEffect(() => {
    if (!isOnline || !items.length) return;
    let active = true;
    setPrimeState({ status: 'running', result: null });
    void primeWorkspaceBoards(workspaceId, items).then((result) => {
      if (active) setPrimeState({ status: 'done', result });
    });
    return () => {
      active = false;
    };
  }, [boardIds, isOnline, workspaceId]);

  return (
    <Screen scroll contentStyle={styles.screen}>
      <ScreenHeader
        title={workspaceName}
        subtitle="Доски"
        onBack={() => navigation.goBack()}
      />

      {!isOnline ? (
        <InlineNotice text="Нет связи. Открываются только сохранённые доски." tone="warning" />
      ) : null}
      {primeState.status === 'running' ? (
        <InlineNotice
          text="Готовим доски для работы без домашнего узла…"
          tone="neutral"
        />
      ) : null}
      {primeState.status === 'done' && primeState.result?.failed ? (
        <InlineNotice
          text={`${primeState.result.failed} досок пока не удалось подготовить. Повторим при следующей связи с узлом.`}
          tone="warning"
        />
      ) : null}

      <View style={styles.toolbar}>
        <Text style={[styles.summary, { color: colors.muted }]}>
          {items.length} {items.length === 1 ? 'доска' : 'досок'}
        </Text>
        <Button
          label="Создать"
          compact
          variant="primary"
          disabled={!isOnline}
          onPress={() => setModalVisible(true)}
        />
      </View>

      {query.isPending && !items.length ? <StateView title="Загружаем доски" busy /> : null}

      {query.isError && !items.length ? (
        <StateView
          title="Доски недоступны"
          description={query.error instanceof Error ? query.error.message : 'Не удалось получить данные.'}
          action={<Button label="Повторить" onPress={() => void query.refetch()} />}
        />
      ) : null}

      {!query.isPending && !items.length ? (
        <StateView
          title="Досок пока нет"
          description={isOnline
            ? 'Создайте первую доску в этом пространстве.'
            : 'После подключения здесь появятся сохранённые доски.'}
          action={isOnline
            ? <Button label="Создать доску" variant="primary" onPress={() => setModalVisible(true)} />
            : undefined}
        />
      ) : null}

      <View style={styles.list}>
        {items.map((board) => (
          <Pressable
            key={board.id}
            onPress={() => navigation.navigate('Board', {
              workspaceId,
              boardId: board.id,
              boardName: board.name,
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
              <Text style={[styles.rowTitle, { color: colors.text }]}>{board.name}</Text>
              <Text style={[styles.rowDescription, { color: colors.muted }]} numberOfLines={2}>
                {board.description || 'Без описания'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
          </Pressable>
        ))}
      </View>

      <FormModal
        visible={modalVisible}
        title="Новая доска"
        onClose={() => {
          if (!createMutation.isPending) setModalVisible(false);
        }}
      >
        <Field
          label="Название"
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Разработка"
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
