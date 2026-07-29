import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
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
import {
  createColumn,
  deleteColumn,
  updateColumn,
} from '../../shared/api/endpoints';
import type { BoardColumn, Card } from '../../shared/types/api';
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
import {
  getAppendPosition,
  getDropColumnIndex,
  getEdgeScrollOffset,
} from './cardDrag';

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

function DragHandle({
  onStart,
  onMove,
  onEnd,
  onCancel,
}: {
  onStart: (pageX: number, pageY: number) => void;
  onMove: (pageX: number, pageY: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const colors = useAppColors();
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      onStart(event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    onPanResponderMove: (event) => {
      onMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    onPanResponderRelease: onEnd,
    onPanResponderTerminate: onCancel,
    onPanResponderTerminationRequest: () => false,
  }), [onCancel, onEnd, onMove, onStart]);

  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Перетащить карточку"
      style={[styles.dragHandle, { backgroundColor: colors.surfaceMuted }]}
    >
      <Text style={[styles.dragHandleText, { color: colors.muted }]}>≡</Text>
    </View>
  );
}

function CardPreview({
  card,
  operationState,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  card: Card;
  operationState: 'pending' | 'failed' | null;
  onPress: () => void;
  onDragStart: (pageX: number, pageY: number) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}) {
  const colors = useAppColors();
  const checklistItems = card.checklistItemCount || 0;
  const completedChecklistItems = Math.min(
    card.checklistCompletedItemCount || 0,
    checklistItems,
  );
  const checklistProgress = checklistItems
    ? completedChecklistItems / checklistItems
    : 0;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: operationState === 'failed' ? colors.danger : colors.border,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.cardOpenArea, { opacity: pressed ? 0.68 : 1 }]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>{card.title}</Text>
        </Pressable>
        <DragHandle
          onStart={onDragStart}
          onMove={onDragMove}
          onEnd={onDragEnd}
          onCancel={onDragCancel}
        />
      </View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.cardBody, { opacity: pressed ? 0.68 : 1 }]}
      >
        {card.description ? (
          <Text style={[styles.cardDescription, { color: colors.muted }]} numberOfLines={3}>
            {card.description}
          </Text>
        ) : null}
        {checklistItems ? (
          <View style={styles.cardProgress}>
            <View style={[styles.cardProgressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.cardProgressFill,
                  {
                    backgroundColor: checklistProgress === 1 ? colors.success : colors.accent,
                    width: `${Math.round(checklistProgress * 100)}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.cardProgressText, { color: colors.muted }]}>
              {completedChecklistItems}/{checklistItems}
            </Text>
          </View>
        ) : null}
        <View style={styles.cardMeta}>
          {card.isArchived ? (
            <Text style={[styles.metaText, { color: colors.warning }]}>В архиве</Text>
          ) : null}
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
    </View>
  );
}

export function BoardScreen({ navigation, route }: Props) {
  const { workspaceId, boardId, boardName } = route.params;
  const colors = useAppColors();
  const { width, height } = useWindowDimensions();
  const { isOnline } = useNetwork();
  const runtime = useLocalBoard(boardId, workspaceId);
  const columnsScrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const lastEdgeScrollAtRef = useRef(0);
  const dragRef = useRef<{
    cardId: string;
    sourceColumnId: string;
    targetColumnId: string;
    pageX: number;
    pageY: number;
  } | null>(null);
  const [createCardColumnId, setCreateCardColumnId] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardDescription, setNewCardDescription] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [columnModal, setColumnModal] = useState(false);
  const [editingColumn, setEditingColumn] = useState<BoardColumn | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnDescription, setNewColumnDescription] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dragState, setDragState] = useState<typeof dragRef.current>(null);

  const snapshot = runtime.snapshot;
  const columns = useMemo(
    () => [...(snapshot?.columns || [])].sort((left, right) => left.position - right.position),
    [snapshot?.columns],
  );
  const displayedCards = useMemo(
    () => (snapshot?.cards || []).filter((card) => showArchived || !card.isArchived),
    [showArchived, snapshot?.cards],
  );
  const selectedCard = (snapshot?.cards || [])
    .find((card) => card.id === selectedCardId) || null;
  const columnWidth = Math.min(Math.max(width - 48, 282), 370);
  const columnStride = columnWidth + spacing.sm;

  async function submitCard() {
    if (!createCardColumnId || !newCardTitle.trim() || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await runtime.createCard({
        title: newCardTitle.trim(),
        description: newCardDescription.trim() || undefined,
        columnId: createCardColumnId,
        status: 'active',
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
      if (editingColumn) {
        await updateColumn(boardId, editingColumn.id, {
          name: newColumnName.trim(),
          description: newColumnDescription.trim() || null,
        });
      } else {
        await createColumn(boardId, {
          name: newColumnName.trim(),
          description: newColumnDescription.trim() || undefined,
          position: columns.reduce(
            (highest, column) => Math.max(highest, column.position),
            0,
          ) + 1000,
        });
      }
      setColumnModal(false);
      setEditingColumn(null);
      setNewColumnName('');
      setNewColumnDescription('');
      await runtime.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить колонку.');
    } finally {
      setFormBusy(false);
    }
  }

  function openCreateColumn() {
    setFormError(null);
    setEditingColumn(null);
    setNewColumnName('');
    setNewColumnDescription('');
    setColumnModal(true);
  }

  function openColumnActions(column: BoardColumn) {
    Alert.alert(column.name, 'Выберите действие с колонкой.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Изменить',
        onPress: () => {
          setFormError(null);
          setEditingColumn(column);
          setNewColumnName(column.name);
          setNewColumnDescription(column.description || '');
          setColumnModal(true);
        },
      },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Удалить колонку?',
            'Колонку с карточками сервер удалить не позволит.',
            [
              { text: 'Отмена', style: 'cancel' },
              {
                text: 'Удалить',
                style: 'destructive',
                onPress: () => {
                  setFormError(null);
                  void deleteColumn(boardId, column.id)
                    .then(runtime.refresh)
                    .catch((error) => {
                      setFormError(error instanceof Error
                        ? error.message
                        : 'Не удалось удалить колонку.');
                    });
                },
              },
            ],
          );
        },
      },
    ]);
  }

  function updateDragState(next: typeof dragRef.current) {
    dragRef.current = next;
    setDragState(next);
  }

  function moveDrag(pageX: number, pageY: number) {
    const current = dragRef.current;
    if (!current || !columns.length) return;
    const targetIndex = getDropColumnIndex({
      scrollOffset: scrollOffsetRef.current,
      pointerX: pageX,
      contentInset: spacing.md,
      columnWidth,
      gap: spacing.sm,
      columnCount: columns.length,
    });
    const targetColumn = columns[targetIndex];
    if (targetColumn) {
      updateDragState({
        ...current,
        targetColumnId: targetColumn.id,
        pageX,
        pageY,
      });
    }

    const nextOffset = getEdgeScrollOffset({
      scrollOffset: scrollOffsetRef.current,
      pointerX: pageX,
      viewportWidth: width,
      columnWidth,
      gap: spacing.sm,
      columnCount: columns.length,
    });
    if (
      nextOffset !== null
      && Date.now() - lastEdgeScrollAtRef.current >= 340
    ) {
      lastEdgeScrollAtRef.current = Date.now();
      scrollOffsetRef.current = nextOffset;
      columnsScrollRef.current?.scrollTo({ x: nextOffset, animated: true });
      const nextColumn = columns[Math.round(nextOffset / columnStride)];
      if (nextColumn) {
        updateDragState({
          ...current,
          targetColumnId: nextColumn.id,
          pageX,
          pageY,
        });
      }
    }
  }

  function startDrag(card: Card, pageX: number, pageY: number) {
    updateDragState({
      cardId: card.id,
      sourceColumnId: card.columnId,
      targetColumnId: card.columnId,
      pageX,
      pageY,
    });
  }

  async function finishDrag() {
    const current = dragRef.current;
    updateDragState(null);
    if (!current || current.targetColumnId === current.sourceColumnId) return;
    const latestCards = runtime.snapshot?.cards || [];
    const position = getAppendPosition(
      latestCards,
      current.targetColumnId,
      current.cardId,
    );
    try {
      await runtime.moveCard(current.cardId, current.targetColumnId, position);
    } catch (error) {
      setFormError(error instanceof Error
        ? error.message
        : 'Не удалось переместить карточку.');
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
        subtitle={`${columns.length} колонок · ${displayedCards.length} карточек`}
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

      <View style={styles.boardTools}>
        <Text style={[styles.dragHint, { color: colors.muted }]}>
          Тяните карточку за ≡ к краю экрана, чтобы перейти в соседнюю колонку.
        </Text>
        <Button
          label={showArchived ? 'Скрыть архив' : 'Показать архив'}
          compact
          variant="ghost"
          onPress={() => setShowArchived((current) => !current)}
        />
      </View>

      {runtime.lastError && !runtime.failedCount ? (
        <InlineNotice text={runtime.lastError} tone={isOnline ? 'danger' : 'warning'} />
      ) : null}

      {!columns.length ? (
        <StateView
          title="На доске нет колонок"
          description={isOnline ? 'Добавьте первую колонку.' : 'Создать колонку можно после подключения.'}
          action={isOnline
            ? <Button label="Добавить колонку" variant="primary" onPress={openCreateColumn} />
            : undefined}
        />
      ) : (
        <ScrollView
          ref={columnsScrollRef}
          horizontal
          scrollEnabled={!dragState}
          showsHorizontalScrollIndicator={false}
          snapToInterval={columnWidth + spacing.sm}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={(event) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.x;
          }}
          contentContainerStyle={styles.columns}
          style={styles.columnsViewport}
        >
          {columns.map((column) => {
            const cards = displayedCards
              .filter((card) => card.columnId === column.id)
              .sort((left, right) => left.position - right.position);
            const isDropTarget = dragState?.targetColumnId === column.id;
            return (
              <View
                key={column.id}
                style={[
                  styles.column,
                  {
                    width: columnWidth,
                    backgroundColor: colors.surfaceMuted,
                    borderColor: isDropTarget ? colors.accent : colors.border,
                    borderWidth: isDropTarget ? 2 : 1,
                  },
                ]}
              >
                <View style={styles.columnHeader}>
                  <Text style={[styles.columnTitle, { color: colors.text }]} numberOfLines={1}>
                    {column.name}
                  </Text>
                  <Text style={[styles.columnCount, { color: colors.muted }]}>{cards.length}</Text>
                  <Pressable
                    onPress={() => openColumnActions(column)}
                    accessibilityRole="button"
                    accessibilityLabel={`Действия с колонкой ${column.name}`}
                    style={({ pressed }) => [
                      styles.columnMenu,
                      {
                        backgroundColor: colors.surface,
                        opacity: pressed ? 0.65 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.columnMenuText, { color: colors.muted }]}>•••</Text>
                  </Pressable>
                </View>
                <Button
                  label="Добавить карточку"
                  compact
                  variant="ghost"
                  onPress={() => {
                    setFormError(null);
                    setCreateCardColumnId(column.id);
                  }}
                />
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
                      onDragStart={(pageX, pageY) => startDrag(card, pageX, pageY)}
                      onDragMove={moveDrag}
                      onDragEnd={() => void finishDrag()}
                      onDragCancel={() => updateDragState(null)}
                    />
                  ))}
                  {!cards.length ? (
                    <Text style={[styles.emptyColumn, { color: colors.muted }]}>
                      Карточек пока нет
                    </Text>
                  ) : null}
                </ScrollView>
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
              onPress={openCreateColumn}
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
        title={editingColumn ? 'Изменить колонку' : 'Новая колонка'}
        onClose={() => {
          if (!formBusy) {
            setColumnModal(false);
            setEditingColumn(null);
          }
        }}
      >
        <Field
          label="Название"
          value={newColumnName}
          onChangeText={setNewColumnName}
          autoFocus
          placeholder="В работе"
        />
        <Field
          label="Описание"
          value={newColumnDescription}
          onChangeText={setNewColumnDescription}
          multiline
          placeholder="Необязательно"
        />
        {formError ? <InlineNotice text={formError} tone="danger" /> : null}
        <Button
          label={editingColumn ? 'Сохранить' : 'Создать'}
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

      {dragState ? (
        <View
          pointerEvents="none"
          style={[
            styles.dragOverlay,
            {
              left: Math.min(Math.max(dragState.pageX - 88, spacing.sm), width - 184),
              top: Math.min(Math.max(dragState.pageY - 118, 88), height - 120),
              backgroundColor: colors.accent,
            },
          ]}
        >
          <Text style={[styles.dragOverlayText, { color: colors.background }]}>
            {columns.find((column) => column.id === dragState.targetColumnId)?.name
              || 'Перемещение'}
          </Text>
        </View>
      ) : null}
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
  boardTools: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dragHint: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
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
  columnMenu: {
    minWidth: 34,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  columnMenuText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -1,
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  cardOpenArea: {
    flex: 1,
    minHeight: 32,
    justifyContent: 'center',
  },
  cardBody: {
    gap: spacing.xs,
  },
  dragHandle: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  dragHandleText: {
    fontSize: 24,
    lineHeight: 25,
    fontWeight: '800',
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
  cardProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardProgressTrack: {
    flex: 1,
    height: 5,
    overflow: 'hidden',
    borderRadius: 999,
  },
  cardProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  cardProgressText: {
    minWidth: 30,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '700',
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
  dragOverlay: {
    position: 'absolute',
    zIndex: 50,
    width: 176,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    elevation: 10,
  },
  dragOverlayText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
  },
});
