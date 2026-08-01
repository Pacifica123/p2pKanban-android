import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdkRoot || !existsSync(sdkRoot)) {
  console.error(
    'Android SDK не найден. Установите Android Studio + Android SDK 36 и задайте ANDROID_HOME.',
  );
  process.exit(2);
}

run(npx, ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], mobileRoot);
if (isWindows) {
  run('gradlew.bat', ['assembleRelease'], join(mobileRoot, 'android'));
} else {
  run('sh', ['./gradlew', 'assembleRelease'], join(mobileRoot, 'android'));
}

const source = join(mobileRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const destination = join(mobileRoot, 'dist', 'p2pKanban-mobile-1.5.0.apk');
if (!existsSync(source)) {
  console.error(`Gradle завершился без ожидаемого APK: ${source}`);
  process.exit(3);
}
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`APK готов: ${destination}`);
