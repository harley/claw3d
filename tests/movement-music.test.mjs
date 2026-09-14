import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementMusic } from '../src/movement-music.js';

test('movement music is opt-in, bounded, and cancels on blocked input or mute', () => {
  const notes = [];
  const audio = { enabled: false, volume: .5, note: (...args) => {
    const record = { args, cancelled: false }; notes.push(record);
    return () => { record.cancelled = true; };
  } };
  const music = createMovementMusic(audio);
  music.update(true, .05); assert.equal(notes.length, 0);
  audio.enabled = true; music.update(true, .05);
  assert.equal(notes.length, 2);
  music.update(false, .05); assert.ok(notes.every(n => n.cancelled));
  const before = notes.length;
  music.update(false, 10); assert.equal(notes.length, before);
  music.update(true, 10); assert.equal(notes.length, before + 2, 'a long frame never queues a backlog');
  audio.volume = 0; music.update(true, .05); assert.ok(notes.every(n => n.cancelled));
  audio.volume = .5; music.update(true, .05); assert.equal(notes.length, before + 4);
  music.stop(); assert.ok(notes.every(n => n.cancelled));
  assert.ok(notes.every(n => n.args[2] === 0 && n.args[1] <= .18), 'no music queued ahead');
});
