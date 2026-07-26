import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { useNetwork } from '../../app/NetworkProvider';
import type { RootStackParamList } from '../../app/navigation/types';
import { radius, spacing, useAppColors } from '../../app/theme';
import { getBoardActivity } from '../../shared/api/endpoints';
import {
  Button,
  InlineNotice,
  Screen,
  ScreenHeader,
  StateView,
} from '../../shared/ui/primitives';

type Props = NativeStackScreenProps<RootStackParamList, 'Activity'>;

const labels: Record<string, string> = {
  'board.created': 'Доска создана',
  'board.updated': 'Доска изменена',
  'card.archived': 'Карточка архивирована',
  'card.created': 'Карточка создана',
  'card.moved': 'Карточка перемещена',
  'card.updated': 'Карточка изменена',
  'column.created': 'Колонка создана',
  'column.deleted': 'Колонка удалена',
  'column.updated': 'Колонка изменена',
};

function dateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ActivityScreen({ navigation, route }: Props) {
  const { boardId, boardName } = route.params;
  const colors = useAppColors();
  const { isOnline } = useNetwork();
  const query = useQuery({
    queryKey: ['activity', boardId],
    queryFn: () => getBoardActivity(boardId),
    enabled: isOnline,
  });

  return (
    <Screen scroll>
      <ScreenHeader title="История" subtitle={boardName} onBack={() => navigation.goBack()} />
      {!isOnline ? (
        <InlineNotice text="История доступна после подключения к узлу." tone="warning" />
      ) : null}
      {query.isPending && isOnline ? <StateView title="Загружаем историю" busy /> : null}
      {query.isError ? (
        <StateView
          title="История недоступна"
          description={query.error instanceof Error ? query.error.message : undefined}
          action={<Button label="Повторить" onPress={() => void query.refetch()} />}
        />
      ) : null}
      {query.data && !query.data.items.length ? (
        <StateView title="История пока пустая" />
      ) : null}
      <View style={styles.list}>
        {query.data?.items.map((entry) => (
          <View
            key={entry.id}
            style={[
              styles.entry,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.entryTitle, { color: colors.text }]}>
              {labels[entry.kind] || entry.kind.replaceAll('.', ' · ')}
            </Text>
            <Text style={[styles.entryMeta, { color: colors.muted }]}>
              {entry.actor.displayName || 'Система'} · {dateTime(entry.createdAt)}
            </Text>
            {entry.fieldMask.length ? (
              <Text style={[styles.entryFields, { color: colors.muted }]}>
                Изменено: {entry.fieldMask.join(', ')}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  entry: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  entryMeta: {
    fontSize: 12,
  },
  entryFields: {
    fontSize: 12,
    lineHeight: 17,
  },
});
