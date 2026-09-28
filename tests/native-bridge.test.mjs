import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBridge, MAX_EXPORT_BYTES } from '../src/native-bridge.js';
function fixture() {
  const sent = [], target = { postMessage: value => sent.push(JSON.parse(value)) };
  const bridge = nativeBridge(target);
  return { bridge, sent, reply: message => target.onmessage({ data: JSON.stringify(message) }) };
}
// Contract: operator export works without a camera and cannot consume tracking replies.
// Existing acquisition tests do not exercise this second bridge consumer.
test('camera-off export sends an exact large snapshot and routes only its own response', async () => {
  const { bridge, sent, reply } = fixture(), messages = [];
  bridge.subscribe(message => messages.push(message.type));
  const data = JSON.stringify({ name: 'Tiếng Việt', scores: 'x'.repeat(10000) });
  const result = bridge.exportScores(data, 'cloud-claw-one-hand.json');
  assert.equal(sent[0].data, data);
  reply({ type: 'ready', generation: 3 });
  reply({ type: 'export-result', id: sent[0].id + 1, status: 'saved' });
  await assert.rejects(bridge.exportScores('{}', 'second.json'), /Finish the open export/);
  reply({ type: 'export-result', id: sent[0].id, status: 'saved' });
  assert.equal(await result, 'saved');
  assert.ok(messages.includes('ready'));
});
test('export cancellation and failure release the request for an explicit retry', async () => {
  const { bridge, sent, reply } = fixture();
  const cancelled = bridge.exportScores('{}', 'one.json');
  reply({ type: 'export-result', id: sent.at(-1).id, status: 'cancelled' });
  assert.equal(await cancelled, 'cancelled');
  const failed = bridge.exportScores('{}', 'one.json');
  reply({ type: 'export-result', id: sent.at(-1).id, status: 'error', message: 'Disk full' });
  await assert.rejects(failed, /Disk full/);
  const retry = bridge.exportScores('{}', 'one.json');
  reply({ type: 'export-result', id: sent.at(-1).id, status: 'saved' });
  assert.equal(await retry, 'saved');
});
test('export bounds UTF-8 bytes before sending and survives a bridge exception', async () => {
  const { bridge, sent } = fixture();
  await assert.rejects(bridge.exportScores('é'.repeat(MAX_EXPORT_BYTES / 2 + 1), 'one.json'), /2 MB/);
  assert.equal(sent.length, 0);
  const broken = nativeBridge({ postMessage() { throw new Error('Bridge gone'); } });
  await assert.rejects(broken.exportScores('{}', 'one.json'), /Bridge gone/);
  await assert.rejects(broken.exportScores('{}', 'one.json'), /Bridge gone/);
});
