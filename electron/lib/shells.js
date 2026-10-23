const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const DEFAULT_SHELL = isWin ? 'cmd' : 'sh';
const SHELL_IDS = isWin
  ? ['cmd', 'powershell', 'pwsh', 'bash']
  : ['sh', 'bash', 'zsh'];

let cache = null;

function fileExists(file) {
  if (!file) return false;
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

function findInPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = isWin
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const variants = isWin ? exts.concat(['']) : [''];

  for (let i = 0; i < dirs.length; i++) {
    for (let j = 0; j < variants.length; j++) {
      const full = path.join(dirs[i], name + variants[j]);
      if (fileExists(full)) return full;
    }
  }
  return null;
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function findCmd() {
  return firstExisting([
    process.env.ComSpec,
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
  ]) || findInPath('cmd');
}

function findPowerShell() {
  return firstExisting([
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ]) || findInPath('powershell');
}

function findPwsh() {
  return firstExisting([
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7-preview', 'pwsh.exe')
  ]) || findInPath('pwsh');
}

function findGitBash() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe')
  ];

  const git = findInPath('git');
  if (git) {
    candidates.push(path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe'));
  }

  const bashInPath = findInPath('bash');
  if (bashInPath && !/[\\/]system32[\\/]/i.test(bashInPath)) {
    candidates.push(bashInPath);
  }

  return firstExisting(candidates);
}

function detectShells(force) {
  if (cache && !force) return cache;

  const list = isWin
    ? [
        { id: 'cmd', label: 'cmd.exe', kind: 'cmd', path: findCmd() },
        { id: 'powershell', label: 'Windows PowerShell 5.1', kind: 'powershell', path: findPowerShell() },
        { id: 'pwsh', label: 'PowerShell 7 (pwsh)', kind: 'powershell', path: findPwsh() },
        { id: 'bash', label: 'Git Bash', kind: 'bash', path: findGitBash() }
      ]
    : [
        { id: 'sh', label: 'sh', kind: 'bash', path: firstExisting(['/bin/sh']) || findInPath('sh') },
        { id: 'bash', label: 'bash', kind: 'bash', path: firstExisting(['/bin/bash']) || findInPath('bash') },
        { id: 'zsh', label: 'zsh', kind: 'bash', path: firstExisting(['/bin/zsh']) || findInPath('zsh') }
      ];

  cache = list.map(function(shell) {
    return {
      id: shell.id,
      label: shell.label,
      kind: shell.kind,
      path: shell.path || '',
      available: !!shell.path,
      default: shell.id === DEFAULT_SHELL
    };
  });

  return cache;
}

function isKnownShellId(id) {
  const value = String(id || '');
  return value === 'auto' || SHELL_IDS.indexOf(value) !== -1;
}

function isAvailable(id) {
  const value = String(id || '');
  if (value === 'auto') return true;
  return detectShells().some(function(shell) {
    return shell.id === value && shell.available;
  });
}

function getShell(id) {
  return detectShells().find(function(shell) {
    return shell.id === id;
  }) || null;
}

function getDefaultShellId() {
  return DEFAULT_SHELL;
}

function buildInvocation(shellId, command) {
  const wanted = shellId && shellId !== 'auto' ? String(shellId) : DEFAULT_SHELL;
  const shell = getShell(wanted);

  if (!shell || !shell.available) {
    const err = new Error('Оболочка «' + wanted + '» не найдена. Выберите другую в настройках.');
    err.code = 'SHELL_MISSING';
    throw err;
  }

  let args;
  if (shell.kind === 'cmd') {
    args = ['/d', '/s', '/c', 'chcp 65001>nul & ' + command];
  } else if (shell.kind === 'powershell') {
    const prefix = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ';
    args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', prefix + command];
  } else {
    args = ['-c', command];
  }

  return {
    id: shell.id,
    label: shell.label,
    path: shell.path,
    kind: shell.kind,
    file: shell.path,
    args: args
  };
}

module.exports = {
  DEFAULT_SHELL,
  detectShells,
  getDefaultShellId,
  isKnownShellId,
  isAvailable,
  getShell,
  buildInvocation
};
