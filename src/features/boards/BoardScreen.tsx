import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useNetwork } from '../../app/NetworkProvider';
import type { RootStackParamList } from '../../app/navigation/types';
import { radius, spacing, useAppColors } from '../../app/theme';
import { createColumn } from '../../shared/api/endpoints';
import type { Card } from '../../shared/types/api';
import {
  Button,
  Field,
  FormModal,
  InlineNotice,
  Screen,
  ScreenHeader,
  StateView,
} from '../../shared/ui/primitives';
import { CardDetailsModal } from '../cards/CardDetailsModal';
import { useLocalBoard } from '../localFirst/useLocalBoard';

type Props = NativeStackScreenProps<RootStackParamList, 'Board'>;

const statusLabels: Record<string, string> = {
  active: 'Активно',
  blocked: 'Заблокировано',
  cancelled: 'Отменено',
  completed: 'Завершено',
  done: 'Готово',
  in_progress: 'В работе',
  todo: 'Запланировано',
};

const priorityLabels: Record<string, string> = {
  high: 'Высокий',
  low: 'Низкий',
  medium: 'Средний',
  urgent: 'Срочно',
};

function CardPreview({
  card,
  operationState,
  onPress,
}: {
  card: Card;
  operationState: 'pending' | 'failed' | null;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: operationState === 'failed' ? colors.danger : colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Text style={[styles.cardTitle, { color: colors.text }]}>{card.title}</Text>
      {card.description ? (
        <Text style={[styles.cardDescription, { color: colors.muted }]} numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}
      <View style={styles.cardMeta}>
        {card.status ? (
          <Text style={[styles.metaText, { color: colors.muted }]}>
            {statusLabels[card.status] || card.status}
          </Text>
        ) : null}
        {card.priority ? (
          <Text style={[styles.metaText, { color: card.priority === 'urgent' ? colors.danger : colors.muted }]}>
            {priorityLabels[card.priority] || card.priority}
          </Text>
        ) : null}
        {operationState ? (
          <Text style={[styles.metaText, { color: operationState === 'failed' ? colors.danger : colors.warning }]}>
            {operationState === 'failed' ? 'Нужна проверка' : 'На устройстве'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function BoardScreen({ navigation, route }: Props) {
  const { workspaceId, boardId, boardName } = route.params;
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const { isOnline } = useNetwork();
  const runtime = useLocalBoard(boardId, workspaceId);
  const [createCardColumnId, setCreateCardColumnId] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardDescription, setNewCardDescription] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [columnModal, setColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const snapshot = runtime.snapshot;
  const columns = useMemo(
    () => [...(snapshot?.columns || [])].sort((left, right) => left.position - right.position),
    [snapshot?.columns],
  );
  const visibleCards = useMemo(
    () => (snapshot?.cards || []).filter((card) => !card.isArchived),
    [snapshot?.cards],
  );
  const selectedCard = visibleCards.find((card) => card.id === selectedCardId) || null;
  const columnWidth = Math.min(Math.max(width - 48, 282), 370);

  async function submitCard() {
    if (!createCardColumnId || !newCardTitle.trim() || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await runtime.createCard({
        title: newCardTitle.trim(),
        description: newCardDescription.trim() || undefined,
        columnId: createCardColumnId,
        status: 'todo',
      });
      setCreateCardColumnId(null);
      setNewCardTitle('');
      setNewCardDescription('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось создать карточку.');
    } finally {
      setFormBusy(false);
    }
  }

  async function submitColumn() {
    if (!newColumnName.trim() || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await createColumn(boardId, {
        name: newColumnName.trim(),
        position: columns.reduce((highest, column) => Math.max(highest, column.position), 0) + 1000,
      });
      setColumnModal(false);
      setNewColumnName('');
      await runtime.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось создать колонку.');
    } finally {
      setFormBusy(false);
    }
  }

  let syncText = 'Синхронизировано';
  let syncTone: 'neutral' | 'danger' | 'warning' | 'success' = 'success';
  if (!isOnline) {
    syncText = runtime.syncMode === 'roaming'
      ? 'Нет интернета · доска работает локально'
      : 'Нет связи · изменения сохраняются на устройстве';
    syncTone = 'warning';
  } else if (runtime.failedCount) {
    syncText = `${runtime.failedCount} изменений требуют проверки`;
    syncTone = 'danger';
  } else if (runtime.flushing) {
    syncText = 'Отправляем сохранённые изменения';
    syncTone = 'neutral';
  } else if (runtime.pendingCount) {
    syncText = `${runtime.pendingCount} изменений сохранено на устройстве`;
    syncTone = 'warning';
  } else if (runtime.syncMode === 'roaming') {
    syncText = `Независимая синхронизация · ${runtime.relayCount} релея`;
    syncTone = 'success';
  }

  if (!runtime.hydrated && !snapshot) {
    return (
      <Screen>
        <ScreenHeader title={boardName} onBack={() => navigation.goBack()} />
        <StateView title="Открываем доску" busy />
      </Screen>
    );
  }

  if (!snapshot) {
    return (
      <Screen>
        <ScreenHeader title={boardName} onBack={() => navigation.goBack()} />
        <StateView
          title="Доска не сохранена на устройстве"
          description={isOnline
            ? runtime.lastError || 'Не удалось получить локальную или relay-копию доски.'
            : 'Подключитесь к интернету или откройте доску после первичной привязки.'}
          action={isOnline ? <Button label="Повторить" onPress={() => void runtime.refresh()} /> : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screen}>
      <ScreenHeader
        title={snapshot.board.name}
        subtitle={`${columns.length} колонок · ${visibleCards.length} карточек`}
        onBack={() => navigation.goBack()}
        action={(
          <Button
            label="История"
            compact
            variant="ghost"
            onPress={() => navigation.navigate('Activity', {
              boardId,
              boardName: snapshot.board.name,
            })}
          />
        )}
      />

      <View style={styles.statusRow}>
        <View style={styles.statusNotice}>
          <InlineNotice text={syncText} tone={syncTone} />
        </View>
        {runtime.failedCount ? (
          <Button label="Повторить" compact onPress={() => void runtime.retryFailed()} />
        ) : (
          <Button
            label="Обновить"
            compact
            loading={runtime.refreshing}
            disabled={!isOnline}
            onPress={() => void runtime.refresh()}
          />
        )}
      </View>

      {runtime.lastError && !runtime.failedCount ? (
        <InlineNotice text={runtime.lastError} tone={isOnline ? 'danger' : 'warning'} />
      ) : null}

      {!columns.length ? (
        <StateView
          title="На доске нет колонок"
          description={isOnline ? 'Добавьте первую колонку.' : 'Создать колонку можно после подключения.'}
          action={isOnline
            ? <Button label="Добавить колонку" variant="primary" onPress={() => setColumnModal(true)} />
            : undefined}
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={columnWidth + spacing.sm}
          decelerationRate="fast"
          contentContainerStyle={styles.columns}
          style={styles.columnsViewport}
        >
          {columns.map((column) => {
            const cards = visibleCards
              .filter((card) => card.columnId === column.id)
              .sort((left, right) => left.position - right.position);
            return (
              <View
                key={column.id}
                style={[
                  styles.column,
                  {
                    width: columnWidth,
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.columnHeader}>
                  <Text style={[styles.columnTitle, { color: colors.text }]} numberOfLines={1}>
                    {column.name}
                  </Text>
                  <Text style={[styles.columnCount, { color: colors.muted }]}>{cards.length}</Text>
                </View>
                <ScrollView
                  style={styles.cardList}
                  contentContainerStyle={styles.cardListContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {cards.map((card) => (
                    <CardPreview
                      key={card.id}
                      card={card}
                      operationState={runtime.cardOperationState(card.id)}
                      onPress={() => setSelectedCardId(card.id)}
                    />
                  ))}
                  {!cards.length ? (
                    <Text style={[styles.emptyColumn, { color: colors.muted }]}>
                      Карточек пока нет
                    </Text>
                  ) : null}
                </ScrollView>
                <Button
                  label="Добавить карточку"
                  compact
                  variant="ghost"
                  onPress={() => {
                    setFormError(null);
                    setCreateCardColumnId(column.id);
                  }}
                />
              </View>
            );
          })}

          <View
            style={[
              styles.addColumn,
              { width: columnWidth, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.addColumnTitle, { color: colors.text }]}>Следующая колонка</Text>
            <Text style={[styles.addColumnText, { color: colors.muted }]}>
              В этой версии колонки создаются через локальный узел; карточки уже
              синхронизируются независимо через зашифрованный журнал.
            </Text>
            <Button
              label="Добавить колонку"
              variant="primary"
              disabled={!isOnline}
              onPress={() => {
                setFormError(null);
                setColumnModal(true);
              }}
            />
          </View>
        </ScrollView>
      )}

      <FormModal
        visible={Boolean(createCardColumnId)}
        title="Новая карточка"
        onClose={() => {
          if (!formBusy) setCreateCardColumnId(null);
        }}
      >
        <Field
          label="Название"
          value={newCardTitle}
          onChangeText={setNewCardTitle}
          autoFocus
          placeholder="Что нужно сделать"
        />
        <Field
          label="Описание"
          value={newCardDescription}
          onChangeText={setNewCardDescription}
          multiline
          placeholder="Необязательно"
        />
        {formError ? <InlineNotice text={formError} tone="danger" /> : null}
        <Button
          label={isOnline ? 'Создать' : 'Сохранить на устройстве'}
          variant="primary"
          loading={formBusy}
          disabled={!newCardTitle.trim()}
          onPress={() => void submitCard()}
        />
      </FormModal>

      <FormModal
        visible={columnModal}
        title="Новая колонка"
        onClose={() => {
          if (!formBusy) setColumnModal(false);
        }}
      >
        <Field
          label="Название"
          value={newColumnName}
          onChangeText={setNewColumnName}
          autoFocus
          placeholder="В работе"
        />
        {formError ? <InlineNotice text={formError} tone="danger" /> : null}
        <Button
          label="Создать"
          variant="primary"
          loading={formBusy}
          disabled={!newColumnName.trim() || !isOnline}
          onPress={() => void submitColumn()}
        />
      </FormModal>

      <CardDetailsModal
        card={selectedCard}
        columns={columns}
        runtime={runtime}
        onClose={() => setSelectedCardId(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusNotice: {
    flex: 1,
  },
  columnsViewport: {
    flex: 1,
    marginHorizontal: -spacing.md,
  },
  columns: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  column: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  columnHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  columnTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  columnCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardList: {
    flex: 1,
  },
  cardListContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyColumn: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
    fontSize: 13,
  },
  addColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  addColumnTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  addColumnText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
