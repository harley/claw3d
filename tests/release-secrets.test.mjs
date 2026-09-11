import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecretRedactor } from '../scripts/release-secrets.mjs';

test('dynamic release credentials are masked with safe command escaping', () => {
  const lines = [], secrets = createSecretRedactor({ actions: true, log: line => lines.push(line) });
  const code = 'dummy%code\r\nnext-line';
  secrets.add(code);
  assert.deepEqual(lines, ['::add-mask::dummy%25code%0D%0Anext-line']);
  assert.equal(secrets.redact(`fill("${code}") failed; retry ${code}`), 'fill("[REDACTED]") failed; retry [REDACTED]');
});

test('local verification never prints raw add-mask commands', () => {
  const lines = [], secrets = createSecretRedactor({ actions: false, log: line => lines.push(line) });
  secrets.add('dummy-host-secret');
  assert.deepEqual(lines, []);
  assert.equal(secrets.redact('fill("dummy-host-secret") timed out'), 'fill("[REDACTED]") timed out');
});
