import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../../server/database.js';
import { createOfficialEvents } from '../../server/official-events.js';

const database = openDatabase(workerData.filename);
try {
  const events = createOfficialEvents(database.db, { now: () => workerData.time });
  const gate = new Int32Array(workerData.gate);
  parentPort.postMessage({ ready: true });
  Atomics.wait(gate, 0, 0);
  try { parentPort.postMessage({ result: events[workerData.method](...workerData.args) }); }
  catch (error) { parentPort.postMessage({ error: { status: error.status, message: error.message } }); }
} finally { database.close(); }
