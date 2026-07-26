# p2pKanban Android

Экспериментальный React Native / Expo-клиент для Android. Он подключается к
обычному self-hosted p2pKanban через тот же Rust API, который использует web,
и не создаёт отдельный мобильный backend.

## Что уже работает

- проверка и сохранение адреса узла;
- регистрация и вход;
- защищённое хранение rotating refresh token через Android Keystore;
- список пространств и досок с локальным кэшем;
- горизонтальная канбан-доска;
- создание, редактирование, перенос и архивирование карточек;
- локальный снимок доски и очередь офлайн-изменений;
- понятные состояния `нет связи`, `сохранено на устройстве`,
  `синхронизация` и `нужна проверка`;
- история доски без вывода сырого JSON;
- светлая и тёмная системная тема.

Колонки, пространства и доски пока создаются только при наличии связи.
Карточки можно создавать и менять офлайн. Сенсорный drag-and-drop, метки,
чек-листы, комментарии, импорт/экспорт и полный экран оформления ещё не
перенесены из web.

## Подключение телефона

На компьютере из корня p2pKanban:

```bash
python bootstrap.py start --listen lan
```

Bootstrap покажет адрес и выбранный порт. В приложении укажите его целиком,
например:

```text
http://192.168.1.42:49152
```

Телефон и компьютер должны находиться в одной доверенной сети. Для Android
Emulator адрес компьютера обычно начинается с `http://10.0.2.2:`.

Локальный HTTP разрешён в Android manifest намеренно, потому что zero-config
bootstrap работает в LAN без TLS. Не публикуйте этот порт напрямую в интернет.
Для удалённого доступа используйте `deploy/home-coordinator` и приватную сеть.

## Запуск для разработки

Нужны Node.js LTS и npm:

```bash
cd mobile
npm ci
npm start
```

Затем откройте проект в Expo Go либо запустите нативную сборку:

```bash
npm run android
```

## Локальная сборка APK

Нужны:

- JDK 17;
- Android Studio;
- Android SDK Platform 36 и Build Tools;
- заданная переменная `ANDROID_HOME` или `ANDROID_SDK_ROOT`.

Сборка одной командой:

```bash
npm ci
npm run apk
```

Готовый файл появится здесь:

```text
mobile/dist/p2pKanban-mobile-1.0.0.apk
```

Скрипт выполняет Expo prebuild, запускает Gradle `assembleRelease` и копирует
результат в стабильное место. Тестовая release-сборка подписывается стандартным
debug keystore нативного шаблона; для Google Play нужен отдельный production
keystore и AAB.

Альтернативный cloud build уже описан в `eas.json`:

```bash
eas build --platform android --profile preview
```

## Проверки

```bash
npm run typecheck
npm test
npm run export:android
```

Reducer-тесты закрепляют порядок офлайн-операций и замену временного ID
карточки серверным. Отдельные тесты проверяют нормализацию адреса и
последовательный поиск health endpoint.

## Почему у mobile отдельный auth endpoint

Web продолжает хранить refresh token только в HttpOnly cookie. React Native
считает cookie-аутентификацию нестабильным местом, поэтому native password flow
возвращает собственный opaque refresh token. Android-клиент кладёт его только
в `expo-secure-store`, поворачивает при каждом refresh и удаляет вместе со
всем session-bound состоянием при выходе или смене узла.

Native endpoints:

```text
POST /api/v1/auth/native/sign-up
POST /api/v1/auth/native/sign-in
POST /api/v1/auth/native/refresh
POST /api/v1/auth/native/sign-out
```

Обычные web endpoints и их HttpOnly cookie не изменены.
