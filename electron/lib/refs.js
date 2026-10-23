const db = require('../db');

const MAX_REFS = 500;
const SOURCE_TYPES = new Set(['note', 'version', 'checklist']);
const TARGET_TYPES = new Set(['note', 'checklist']);

function refKey(type, id) {
  return String(type) + ':' + String(id);
}

function emptyRefs() {
  return { note_ids: [], checklist_ids: [] };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Валидирует связи сущности: только объекты своего проекта, без дублей и self-link.
function sanitizeRefs(raw, projectId, options) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourceType = options && options.sourceType ? String(options.sourceType) : '';
  const sourceId = options && options.sourceId != null ? String(options.sourceId) : '';

  const noteIds = [];
  const checklistIds = [];
  const seenNotes = new Set();
  const seenChecklist = new Set();

  const noteExists = db.prepare('SELECT id FROM notes WHERE id = ? AND project_id = ?');
  const itemExists = db.prepare('SELECT id FROM checklist_items WHERE id = ? AND project_id = ?');

  const rawNoteIds = asArray(source.note_ids).concat(asArray(source.noteIds));
  for (const value of rawNoteIds) {
    const id = String(value == null ? '' : value).trim();
    if (!id || seenNotes.has(id)) continue;
    if (sourceType === 'note' && sourceId === id) continue;
    if (!noteExists.get(id, projectId)) continue;
    seenNotes.add(id);
    noteIds.push(id);
    if (noteIds.length >= MAX_REFS) break;
  }

  const rawChecklistIds = asArray(source.checklist_ids)
    .concat(asArray(source.checklistIds))
    .concat(asArray(source.links)); // старый формат заметок
  for (const value of rawChecklistIds) {
    const id = parseInt(value, 10);
    if (!Number.isFinite(id) || seenChecklist.has(id)) continue;
    if (sourceType === 'checklist' && sourceId === String(id)) continue;
    if (!itemExists.get(id, projectId)) continue;
    seenChecklist.add(id);
    checklistIds.push(id);
    if (checklistIds.length >= MAX_REFS) break;
  }

  return { note_ids: noteIds, checklist_ids: checklistIds };
}

function getRefs(projectId, sourceType, sourceId) {
  const rows = db.prepare(`
    SELECT target_type, target_id
    FROM entity_links
    WHERE project_id = ? AND source_type = ? AND source_id = ?
    ORDER BY position ASC, id ASC
  `).all(projectId, String(sourceType), String(sourceId));

  const refs = emptyRefs();
  rows.forEach(row => {
    if (row.target_type === 'note') {
      refs.note_ids.push(String(row.target_id));
    } else if (row.target_type === 'checklist') {
      const id = parseInt(row.target_id, 10);
      if (Number.isFinite(id)) refs.checklist_ids.push(id);
    }
  });
  return refs;
}

// Все связи проекта одним запросом: Map<"type:id", { note_ids, checklist_ids }>
function getRefsForProject(projectId) {
  const rows = db.prepare(`
    SELECT source_type, source_id, target_type, target_id
    FROM entity_links
    WHERE project_id = ?
    ORDER BY position ASC, id ASC
  `).all(projectId);

  const map = new Map();
  rows.forEach(row => {
    const key = refKey(row.source_type, row.source_id);
    let refs = map.get(key);
    if (!refs) {
      refs = emptyRefs();
      map.set(key, refs);
    }
    if (row.target_type === 'note') {
      refs.note_ids.push(String(row.target_id));
    } else if (row.target_type === 'checklist') {
      const id = parseInt(row.target_id, 10);
      if (Number.isFinite(id)) refs.checklist_ids.push(id);
    }
  });
  return map;
}

function setRefs(projectId, sourceType, sourceId, raw, options) {
  if (!SOURCE_TYPES.has(sourceType)) return emptyRefs();

  const refs = sanitizeRefs(raw, projectId, {
    ...(options || {}),
    sourceType,
    sourceId
  });

  const remove = db.prepare(`
    DELETE FROM entity_links
    WHERE project_id = ? AND source_type = ? AND source_id = ?
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO entity_links
      (project_id, source_type, source_id, target_type, target_id, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    remove.run(projectId, sourceType, String(sourceId));
    refs.note_ids.forEach((id, index) => {
      insert.run(projectId, sourceType, String(sourceId), 'note', String(id), index);
    });
    refs.checklist_ids.forEach((id, index) => {
      insert.run(projectId, sourceType, String(sourceId), 'checklist', String(id), index);
    });
  })();

  return refs;
}

// Удаляет связи, у которых больше нет источника или цели.
function cleanupOrphans(projectId) {
  const result = db.prepare(`
    DELETE FROM entity_links
    WHERE project_id = ?
      AND (
        source_type NOT IN ('note', 'version', 'checklist')
        OR target_type NOT IN ('note', 'checklist')
        OR (source_type = 'note' AND NOT EXISTS (
          SELECT 1 FROM notes n
          WHERE n.project_id = entity_links.project_id
            AND CAST(n.id AS TEXT) = entity_links.source_id
        ))
        OR (source_type = 'version' AND NOT EXISTS (
          SELECT 1 FROM versions v
          WHERE v.project_id = entity_links.project_id
            AND CAST(v.id AS TEXT) = entity_links.source_id
        ))
        OR (source_type = 'checklist' AND NOT EXISTS (
          SELECT 1 FROM checklist_items ci
          WHERE ci.project_id = entity_links.project_id
            AND CAST(ci.id AS TEXT) = entity_links.source_id
        ))
        OR (target_type = 'note' AND NOT EXISTS (
          SELECT 1 FROM notes n
          WHERE n.project_id = entity_links.project_id
            AND CAST(n.id AS TEXT) = entity_links.target_id
        ))
        OR (target_type = 'checklist' AND NOT EXISTS (
          SELECT 1 FROM checklist_items ci
          WHERE ci.project_id = entity_links.project_id
            AND CAST(ci.id AS TEXT) = entity_links.target_id
        ))
      )
  `).run(String(projectId));
  return result.changes;
}

function removeRefsForSource(projectId, sourceType, sourceId) {
  db.prepare(`
    DELETE FROM entity_links
    WHERE project_id = ? AND source_type = ? AND source_id = ?
  `).run(projectId, String(sourceType), String(sourceId));
}

function removeRefsForTarget(projectId, targetType, targetId) {
  if (!TARGET_TYPES.has(targetType)) return;
  db.prepare(`
    DELETE FROM entity_links
    WHERE project_id = ? AND target_type = ? AND target_id = ?
  `).run(projectId, targetType, String(targetId));
}

// Удаляет связи сущности и как источника, и как цели.
function removeEntityRefs(projectId, type, id) {
  removeRefsForSource(projectId, type, id);
  removeRefsForTarget(projectId, type, id);
}

function attachRefs(entity, refs) {
  if (!entity) return entity;
  const value = refs || emptyRefs();
  entity.note_ids = value.note_ids.slice();
  entity.checklist_ids = value.checklist_ids.slice();
  return entity;
}

function attachRefsToEntities(entities, sourceType, linksMap) {
  (entities || []).forEach(entity => {
    attachRefs(entity, linksMap.get(refKey(sourceType, entity.id)));
  });
  return entities;
}

module.exports = {
  sanitizeRefs,
  getRefs,
  getRefsForProject,
  setRefs,
  cleanupOrphans,
  removeRefsForSource,
  removeRefsForTarget,
  removeEntityRefs,
  attachRefs,
  attachRefsToEntities,
  refKey
};
