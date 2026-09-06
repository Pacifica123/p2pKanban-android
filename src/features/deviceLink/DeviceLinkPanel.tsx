import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAppColors } from '../../app/theme';
import { Button, Field, InlineNotice, Panel } from '../../shared/ui/primitives';
import { useAuth } from '../auth/AuthProvider';
import {
  approveDevice,
  deviceFingerprint,
  preparationInfo,
  prepareDeviceLink,
} from './service';
import { checkRequest } from './protocol';
export function DeviceLinkPanel() {
  const colors = useAppColors(),
    { user } = useAuth();
  const [expanded, setExpanded] = useState(false),
    [request, setRequest] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [fingerprint, setFingerprint] = useState('');
  async function refresh() {
    setFingerprint(await deviceFingerprint());
    const info = await preparationInfo();
    setStatus(
      info
        ? `Подготовлено ${info.boards} досок · ${info.exportedAt}. Право до ${new Date(info.expiresAt * 1000).toLocaleDateString()}.`
        : 'Подключение ещё не подготовлено.',
    );
  }
  useEffect(() => {
    if (expanded) void refresh().catch((e) => setStatus(String(e)));
  }, [expanded]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function confirm() {
    try {
      const checked = checkRequest(JSON.parse(request));
      Alert.alert(
        'Разрешить самостоятельный узел?',
        `Сверьте полный отпечаток запроса на ноутбуке:\n${checked.id}\n\nБудут переданы ваши пространства владельца, данные и право подключать другие устройства от вашего имени. Телефон не станет посредником.`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Совпадает · разрешить',
            onPress: () => {
              void run(async () => {
                if (!user) throw new Error('Нужен аккаунт.');
                await approveDevice(request, user.id);
                setStatus(
                  'Передайте зашифрованный файл ноутбуку до истечения 10 минут.',
                );
              });
            },
          },
        ],
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Panel>
      <Button
        label="Подключить другое устройство"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text }}>
            Подготовьте доступ, пока исходный узел доступен. После этого
            владелец может подключить ноутбук без PC-node. На ноутбуке нужен
            запущенный p2pKanban v2 с пустой базой.
          </Text>
          <Button
            label="Подготовить / обновить доступ"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                await prepareDeviceLink();
                await refresh();
              });
            }}
          />
          <InlineNotice text={status} tone="neutral" />
          <Text selectable style={{ color: colors.text }}>
            Ключ этого устройства — сверьте на ноутбуке:\n{fingerprint}
          </Text>
          <Field
            label="Запрос с ноутбука (JSON)"
            multiline
            value={request}
            onChangeText={setRequest}
            editable={!busy}
          />
          <Button
            label="Проверить и разрешить"
            disabled={busy || !request.trim()}
            onPress={confirm}
          />
          <Text style={{ color: colors.muted }}>
            Файл зашифрован, пароли и master secrets не передаются. Структура и
            комментарии берутся из подготовленного снимка; карточки и чек-листы
            — из локальной копии. При изменении прав обновите подготовку.
          </Text>
        </View>
      )}
    </Panel>
  );
}
