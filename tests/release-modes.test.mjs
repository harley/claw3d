import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedPublicTry, expectedOfficialEvents, expectedPublicDiagnostics } from '../scripts/release-browser.mjs';

for (const [name, parse] of Object.entries({ EXPECTED_PUBLIC_TRY: expectedPublicTry, EXPECTED_OFFICIAL_EVENTS: expectedOfficialEvents, EXPECTED_PUBLIC_DIAGNOSTICS: expectedPublicDiagnostics })) {
  test(`${name} accepts only explicit booleans and defaults private`, () => {
    assert.equal(parse(), false);
    assert.equal(parse('true'), true);
    assert.equal(parse('false'), false);
    for (const invalid of ['', 'TRUE', '1', 'enabled', true, false, null]) assert.throws(() => parse(invalid), new RegExp(name));
  });
}
