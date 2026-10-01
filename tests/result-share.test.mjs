import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultShare } from '../src/result-share.js';

// Sharing must use a saved result and a public root URL. A pending total or
// setup/recovery credentials in a copied link would mislead or expose players.
test('result sharing excludes unfinished scores and private URL components', () => {
  const run = { name: 'Miso', total: 350, turns: [{ prizeId: 'miso' }, { prizeId: 'sprout' }, { prizeId: null }] };
  assert.equal(resultShare(run, 'https://claw.coderpush.com'), null);
  assert.equal(resultShare({ ...run, rank: 1, turns: [] }, 'https://claw.coderpush.com'), null);
  assert.deepEqual(resultShare({ ...run, rank: 2 }, 'https://claw.coderpush.com/staff?ticket=secret#host'), {
    title: 'Claw · Three turns', text: 'Miso scored 350 in Claw!\n🧸 ⭐ —\nThree turns. Can you beat it?', url: 'https://claw.coderpush.com/',
  });
});
