import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, useAppColors } from '../../app/theme';
import type { LocalBoardRuntime } from '../localFirst/useLocalBoard';
import type {
  BoardColumn,
  Card,
  CardPriority,
  CardStatus,
} from '../../shared/types/api';
import {
  Button,
  Field,
  FormModal,
  InlineNotice,
  SectionTitle,
} from '../../shared/ui/primitives';

const statuses: Array<{ value: CardStatus; label: string }> = [
  { value: null, label: 'Без статуса' },
  { value: 'todo', label: 'Запланировано' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'blocked', label: 'Заблокировано' },
  { value: 'done', label: 'Готово' },
];

const priorities: Array<{ value: CardPriority; label: string }> = [
  { value: null, label: 'Без приоритета' },
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'urgent', label: 'Срочно' },
];

function Choice<T extends string | null>({
  value,
  selected,
  label,
  onPress,
}: {
  value: T;
  selected: T;
  label: string;
  onPress: (value: T) => void;
}) {
  const colors = useAppColors();
  const active = value === selected;
  return (
    <Pressable
      onPress={() => onPress(value)}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: active ? colors.accentSoft : colors.surface,
          borderColor: active ? colors.accent : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.choiceText, { color: active ? colors.accent : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CardDetailsModal({
  card,
  columns,
  runtime,
  onClose,
}: {
  card: Card | null;
  columns: BoardColumn[];
  runtime: LocalBoardRuntime;
  onClose: () => void;
}) {
  const colors = useAppColors();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<CardStatus>(null);
  const [priority, setPriority] = useState<CardPriority>(null);
  const [columnId, setColumnId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!card) return;
    setTitle(card.title);
    setDescription(card.description || '');
    setStatus(card.status);
    setPriority(card.priority);
    setColumnId(card.columnId);
    setError(null);
  }, [card]);

  async function save() {
    if (!card || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await runtime.updateCard(card.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
      });
      if (columnId && columnId !== card.columnId) {
        await runtime.moveCard(card.id, columnId);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить карточку.');
    } finally {
      setSaving(false);
    }
  }

  function confirmArchive() {
    if (!card) return;
    Alert.alert(
      'Архивировать карточку?',
      'Карточка исчезнет с доски после сохранения изменения.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Архивировать',
          style: 'destructive',
          onPress: () => {
            void runtime.archiveCard(card.id).then(onClose).catch((reason) => {
              setError(reason instanceof Error ? reason.message : 'Не удалось архивировать карточку.');
            });
          },
        },
      ],
    );
  }

  return (
    <FormModal visible={Boolean(card)} title="Карточка" onClose={onClose}>
      <Field label="Название" value={title} onChangeText={setTitle} />
      <Field
        label="Описание"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Что нужно сделать"
      />

      <View style={styles.section}>
        <SectionTitle title="Статус" />
        <View style={styles.choices}>
          {statuses.map((item) => (
            <Choice
              key={item.value || 'none'}
              value={item.value}
              selected={status}
              label={item.label}
              onPress={setStatus}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle title="Приоритет" />
        <View style={styles.choices}>
          {priorities.map((item) => (
            <Choice
              key={item.value || 'none'}
              value={item.value}
              selected={priority}
              label={item.label}
              onPress={setPriority}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle title="Колонка" />
        <View style={styles.columnChoices}>
          {columns.map((column) => {
            const active = column.id === columnId;
            return (
              <Pressable
                key={column.id}
                onPress={() => setColumnId(column.id)}
                style={({ pressed }) => [
                  styles.columnChoice,
                  {
                    backgroundColor: active ? colors.accentSoft : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.columnChoiceText, { color: colors.text }]}>
                  {column.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? <InlineNotice text={error} tone="danger" /> : null}
      <Button
        label="Сохранить"
        variant="primary"
        loading={saving}
        disabled={!title.trim()}
        onPress={() => void save()}
      />
      <Button label="Архивировать" variant="danger" onPress={confirmArchive} />
    </FormModal>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  choice: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  choiceText: {
    fontSize: 13,
    fontWeight: '700',
  },
  columnChoices: {
    gap: spacing.xs,
  },
  columnChoice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  columnChoiceText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
