// Подтягивает prebuilt-бинарник better-sqlite3 под ABI текущего Electron.
// Нужно потому, что npm по умолчанию ставит сборку под Node, а для Electron
// ABI отличается. Для Electron 42 (ABI 146) prebuilt существует.
const { execFileSync } = require('child_process');
const path = require('path');

function log(msg) { console.log('[fetch-native] ' + msg); }

function run() {
  let electronVersion;
  try {
    electronVersion = require('electron/package.json').version;
  } catch (e) {
    log('electron не найден, пропускаю.');
    return;
  }

  let bsDir;
  try {
    bsDir = path.dirname(require.resolve('better-sqlite3/package.json'));
  } catch (e) {
    log('better-sqlite3 не найден, пропускаю.');
    return;
  }

  let installBin;
  try {
    installBin = require.resolve('prebuild-install/bin.js');
  } catch (e) {
    log('prebuild-install не найден, пропускаю.');
    return;
  }

  const args = [installBin, '--runtime', 'electron', '--target', electronVersion, '--arch', process.arch, '--verbose'];
  log('сборка better-sqlite3 для Electron ' + electronVersion + ' (' + process.arch + ')');
  try {
    execFileSync(process.execPath, args, { cwd: bsDir, stdio: 'inherit' });
    log('готово.');
  } catch (e) {
    log('не удалось получить prebuilt для Electron ' + electronVersion + '.');
    log('Проверьте, что версия Electron имеет prebuilt: https://github.com/WiseLibs/better-sqlite3/releases');
    process.exitCode = 1;
  }
}

run();
