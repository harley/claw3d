import { IDBFactory } from 'fake-indexeddb';
import { openPublicRunJournal } from '../src/public-run-journal.js';
export function journalFixture() {
  let held = false;
  const indexedDB = new IDBFactory();
  const locks = { async request(_name, _options, callback) {
    if (held) return callback(null);
    held = true;
    try { return await callback({ name: 'test-lock' }); } finally { held = false; }
  } };
  return { indexedDB, locks, open: () => openPublicRunJournal({ indexedDB, locks }) };
}
