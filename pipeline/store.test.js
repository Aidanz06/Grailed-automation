/*
 * Store unit tests (node --test, in-memory SQLite — offline, free).
 * Started for addPhotos (UX audit #1: the editor's "+ add photo" must
 * actually persist); grow this file as store behaviors gain guarantees.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('./store');

function memStore() {
  return openStore(':memory:');
}

test('addPhotos appends after existing photos and returns fresh rows', () => {
  const store = memStore();
  const itemId = store.saveItemRun({ photos: ['/shoot/a.jpg', '/shoot/b.jpg'], status: 'draft' });

  const rows = store.addPhotos(itemId, ['/extra/c.jpg', '/extra/d.jpg']);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.file_path),
    ['/shoot/a.jpg', '/shoot/b.jpg', '/extra/c.jpg', '/extra/d.jpg']
  );
  // Rows come back in display order with real numeric ids (the save shape
  // filters non-numeric ids, so these MUST be store ids, not placeholders).
  for (const r of rows) assert.equal(typeof r.id, 'number');

  // getItem sees the same order — the append survives a reload.
  const item = store.getItem(itemId);
  assert.deepEqual(
    item.photos.map((p) => p.file_path),
    ['/shoot/a.jpg', '/shoot/b.jpg', '/extra/c.jpg', '/extra/d.jpg']
  );
  store.close();
});

test('addPhotos lands after a user reorder (explicit positions)', () => {
  const store = memStore();
  const itemId = store.saveItemRun({ photos: ['/shoot/a.jpg', '/shoot/b.jpg'], status: 'draft' });
  const [a, b] = store.getItem(itemId).photos.map((p) => p.id);
  // User reorders b before a (saveItemEdits assigns positions 0..n-1).
  store.saveItemEdits(itemId, { photos: [b, a] });

  store.addPhotos(itemId, ['/extra/c.jpg']);
  assert.deepEqual(
    store.getItem(itemId).photos.map((p) => p.file_path),
    ['/shoot/b.jpg', '/shoot/a.jpg', '/extra/c.jpg']
  );
  store.close();
});

test('addPhotos on an empty item and unknown item', () => {
  const store = memStore();
  const itemId = store.saveItemRun({ photos: [], status: 'draft' });
  const rows = store.addPhotos(itemId, ['/extra/a.jpg']);
  assert.deepEqual(rows.map((r) => r.file_path), ['/extra/a.jpg']);
  assert.throws(() => store.addPhotos(999999, ['/x.jpg']), /not found/);
  store.close();
});
