// Хранение закреплённых на Mind Map файлов.
// Записи типизированы: { kind: 'upload', id } для загруженных в проект
// и { kind: 'path', path } для файлов из папки проекта.
// Для обратной совместимости числа читаются как upload-идентификаторы.

export function parseMindmapFiles(raw) {
  var arr;
  try { arr = JSON.parse(raw || '[]'); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) return [];

  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i];
    if (typeof e === 'number') {
      out.push({ kind: 'upload', id: e });
    } else if (typeof e === 'string') {
      out.push({ kind: 'upload', id: parseInt(e) });
    } else if (e && e.kind === 'upload') {
      out.push({ kind: 'upload', id: parseInt(e.id) });
    } else if (e && e.kind === 'path') {
      out.push({ kind: 'path', path: String(e.path) });
    }
  }
  return out;
}

export function hasUploadFile(list, id) {
  var nid = parseInt(id);
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'upload' && list[i].id === nid) return true;
  }
  return false;
}

export function hasPathFile(list, path) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'path' && list[i].path === path) return true;
  }
  return false;
}

// Возвращает true, если файл добавлен, false — если убран
export function toggleUploadFile(list, id) {
  var nid = parseInt(id);
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'upload' && list[i].id === nid) {
      list.splice(i, 1);
      return false;
    }
  }
  list.push({ kind: 'upload', id: nid });
  return true;
}

export function togglePathFile(list, path) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'path' && list[i].path === path) {
      list.splice(i, 1);
      return false;
    }
  }
  list.push({ kind: 'path', path: path });
  return true;
}
