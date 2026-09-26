import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForRelease } from '../scripts/release-readiness.mjs';
import { expectedPublicTry } from '../scripts/release-browser.mjs';

test('release entry expectation defaults private and rejects ambiguous flag values', () => {
  assert.equal(expectedPublicTry(), false);
  assert.equal(expectedPublicTry('false'), false);
  assert.equal(expectedPublicTry('true'), true);
  for (const value of ['', 'TRUE', '1', true]) assert.throws(() => expectedPublicTry(value), /must be true or false/);
});

const expected = '123abcd'.padEnd(40, '0');
const ready = { sourceCommit: expected, commit: '123abcd', branch: 'main', dirty: false };
const login = () => new Response('{}', { headers: { 'Set-Cookie': 'pilot=fake; HttpOnly' } });
const build = value => Response.json(value);
const options = { origin: 'https://example.invalid', expected, staffCode: 'test-only', wait: async () => {} };

test('release readiness retries interrupted sign-in and waits for the new build', async () => {
  const responses = [new Error('connection reset'), new Response('', { status: 502 }), login(), build({ ...ready, commit: 'old' }), build(ready)];
  const paths = [];
  const result = await waitForRelease({ ...options, attempts: 5, fetcher: async url => {
    paths.push(new URL(url).pathname);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  } });
  assert.deepEqual(result.build, ready);
  assert.equal(paths.filter(path => path === '/api/login').length, 3);
  assert.equal(paths.filter(path => path === '/build-info.json').length, 2);
});

test('invalid credentials fail immediately instead of consuming the login rate limit', async () => {
  let calls = 0;
  await assert.rejects(waitForRelease({ ...options, fetcher: async () => { calls++; return new Response('', { status: 401 }); } }), /not retrying credentials/);
  assert.equal(calls, 1);
});

test('a wrong, dirty or feature-branch build cannot pass release verification', async () => {
  for (const value of [{ ...ready, sourceCommit: '123abcd'.padEnd(40, '1') }, { ...ready, commit: 'old' }, { ...ready, dirty: true }, { ...ready, branch: 'feature' }]) {
    let calls = 0;
    await assert.rejects(waitForRelease({ ...options, attempts: 2, fetcher: async () => ++calls === 1 ? login() : build(value) }), /did not reach/);
    assert.equal(calls, 3);
  }
});
