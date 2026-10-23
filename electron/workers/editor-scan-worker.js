'use strict';

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

const EDITOR_KEYWORDS = /(sublime|vs ?code|vscode|microsoft vs code|cursor|windsurf|jetbrains|intellij|webstorm|pycharm|phpstorm|goland|clion|rider|notepad\+\+|android studio)/i;

const EDITOR_EXE_NAMES = new Set([
  'sublime_text.exe', 'subl.exe', 'code.exe', 'cursor.exe', 'windsurf.exe',
  'notepad++.exe', 'idea64.exe', 'webstorm64.exe', 'pycharm64.exe',
  'phpstorm64.exe', 'goland64.exe', 'clion64.exe', 'rider64.exe', 'studio64.exe'
]);

function scanDrivesForEditors(drives, TIME_LIMIT, STEP_LIMIT) {
  const found = [];
  const seen = new Set();
  const started = Date.now();
  let steps = 0;

  const walk = function(dir, depth, inKeyword) {
    if (Date.now() - started > TIME_LIMIT || steps > STEP_LIMIT) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    steps += entries.length;

    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (inKeyword) {
          if (depth < 6) walk(full, depth + 1, true);
        } else if (EDITOR_KEYWORDS.test(ent.name)) {
          walk(full, depth + 1, true);
        } else if (depth < 1) {
          walk(full, depth + 1, false);
        }
      } else if (ent.isFile()) {
        if (inKeyword || depth === 0) {
          const low = ent.name.toLowerCase();
          if (EDITOR_EXE_NAMES.has(low)) {
            const key = path.resolve(full).toLowerCase();
            if (!seen.has(key)) { seen.add(key); found.push(full); }
          }
        }
      }
    }
  };

  (Array.isArray(drives) ? drives : []).forEach(function(r) { walk(r, 0, false); });
  return found;
}

let result = [];
try {
  const data = workerData || {};
  const timeLimit = Number(data.timeLimit) > 0 ? Number(data.timeLimit) : 2500;
  const stepLimit = Number(data.stepLimit) > 0 ? Number(data.stepLimit) : 40000;
  result = scanDrivesForEditors(data.drives, timeLimit, stepLimit);
} catch (e) {
  result = [];
}

if (parentPort) parentPort.postMessage(result);
