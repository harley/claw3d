import test from 'node:test';
import assert from 'node:assert/strict';
import { address, clientAddressResolver, createBudget } from '../server/request-budget.js';

test('proxy trust requires an exact immediate peer; spoofed chains and address aliases cannot rotate buckets', () => {
  const request = (peer, real, xff = '192.0.2.2') => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': real, 'x-forwarded-for': xff } });
  const direct = clientAddressResolver(), proxied = clientAddressResolver(['127.0.0.1']);
  for (const real of ['192.0.2.1', '192.0.2.2', 'invalid']) assert.equal(direct(request('::ffff:127.0.0.1', real)), '127.0.0.1');
  assert.equal(proxied(request('127.0.0.1', '2001:0db8:0:0::1')), '2001:db8::1');
  assert.equal(address('::ffff:c000:201'), '192.0.2.1');
  for (const real of [undefined, ['192.0.2.1', '192.0.2.2'], '192.0.2.1,192.0.2.2', 'fe80::1%lo0', 'garbage']) assert.equal(proxied(request('127.0.0.1', real)), 'unknown-proxy-client');
  assert.equal(proxied(request('127.0.0.2', '192.0.2.9')), '127.0.0.2');
  for (const peers of [true, ['*'], ['127.0.0.0/8'], ['']]) assert.throws(() => clientAddressResolver(peers));
});

test('hard budget capacity rejects new identities without evicting live limits; expiry restores capacity', () => {
  let time = 0; const budget = createBudget({ now: () => time });
  budget.take('victim', 1);
  for (let i = 1; i < 10_000; i++) budget.take(`key:${i}`, 1);
  for (let i = 0; i < 1000; i++) assert.throws(() => budget.take(`overflow:${i}`, 1), e => e.status === 429 && e.retryAfter === 60);
  assert.equal(budget.size, 10_000);
  time = 59_001;
  assert.throws(() => budget.take('victim', 1), e => e.status === 429 && e.retryAfter === 1);
  time = 60_000;
  budget.take('new', 1); assert.equal(budget.size, 1);
  assert.throws(() => budget.take('x'.repeat(161), 1));
});
