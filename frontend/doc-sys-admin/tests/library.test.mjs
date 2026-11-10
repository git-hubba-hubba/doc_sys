import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../src/lib/workflow.mjs';
import { readLibrary, writeLibrary, upsertDocument } from '../src/lib/library.mjs';

const text = 'Trees cool cities through shade and evaporation. Urban trees support birds and insects by providing shelter and food. Cities should plan tree planting around local soil and rainfall. Young trees need water and maintenance to survive.';
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
async function completedDocument() {
  const logs = [], errors = [];
  const state = await runWorkflow({ name: 'trees.txt', size: text.length, text: async () => text }, {
    fetcher: async () => ({ ok: true, json: async () => ({ query: { pages: {} } }) }),
    onEvent: event => { if (event.kind === 'process') logs.push(event); if (event.kind === 'error') errors.push(event); },
  });
  return { id: 'trees', savedAt: Date.now(), state, logs, errors, answers: { trees: 'trees' } };
}

test('completed results survive serialization, updates, and removal without changing source evidence', async () => {
  const browser = storage();
  assert.deepEqual(readLibrary(browser), []);
  const record = await completedDocument();
  writeLibrary(browser, upsertDocument([], record));
  const restored = readLibrary(browser);
  assert.deepEqual(restored, [record]);
  assert.equal(restored[0].state.article.text, text);
  assert.equal(restored[0].answers.trees, 'trees');
  const updated = { ...record, savedAt: record.savedAt + 1000, answers: {} };
  writeLibrary(browser, upsertDocument(restored, updated));
  assert.deepEqual(readLibrary(browser), [updated]);
  const second = { ...record, id: 'second' };
  writeLibrary(browser, upsertDocument(readLibrary(browser), second));
  writeLibrary(browser, readLibrary(browser).filter(item => item.id !== record.id));
  assert.deepEqual(readLibrary(browser), [second]);
});

test('incomplete runs cannot be persisted', async () => {
  const record = await completedDocument();
  const partial = { ...record, state: { ...record.state, trace: record.state.trace.filter(step => step.tool !== 'verify') } };
  assert.throws(() => upsertDocument([], partial), /completed/);
  assert.throws(() => writeLibrary(storage(), [partial]), /completed/);
});

test('unavailable, full, and corrupt storage report failures instead of silently losing documents', async () => {
  const record = await completedDocument();
  const browser = storage();
  writeLibrary(browser, [record]);
  const before = readLibrary(browser);
  assert.throws(() => writeLibrary({ setItem() { throw new Error('Quota exceeded'); } }, [record]), /Quota/);
  assert.deepEqual(readLibrary(browser), before);
  assert.throws(() => readLibrary({ getItem() { throw new Error('Access denied'); } }), /Access/);
  assert.throws(() => readLibrary({ getItem: () => '{broken' }));
  assert.throws(() => readLibrary({ getItem: () => '[{"id":"bad"}]' }), /could not be read/);
});
