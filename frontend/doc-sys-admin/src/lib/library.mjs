const STORAGE_KEY = 'whuddup-doc:library:v1';

function isDocument(record) {
  const state = record?.state;
  return typeof record?.id === 'string' && Number.isFinite(record.savedAt)
    && typeof state?.article?.title === 'string' && typeof state.article.text === 'string'
    && ['sentences'].every(key => Array.isArray(state.article[key]))
    && ['keywords', 'context', 'summaries', 'dashboard', 'game', 'checks', 'trace'].every(key => Array.isArray(state[key]))
    && state.trace.some(step => step.tool === 'verify' && step.status === 'done')
    && state.counters && Array.isArray(state.synopsis?.statements) && Array.isArray(state.synopsis?.shared)
    && Array.isArray(record.logs) && Array.isArray(record.errors);
}

export function readLibrary(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const records = JSON.parse(raw);
  if (!Array.isArray(records) || !records.every(isDocument)) {
    throw new Error('Saved documents could not be read.');
  }
  return records;
}

export function writeLibrary(storage, records) {
  if (!Array.isArray(records) || !records.every(isDocument)) throw new Error('Only completed documents can be saved.');
  storage.setItem(STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function upsertDocument(records, record) {
  if (!isDocument(record)) throw new Error('Only completed documents can be saved.');
  return [record, ...records.filter(item => item.id !== record.id)];
}
