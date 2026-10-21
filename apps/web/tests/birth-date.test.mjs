import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarDate } from '../src/features/profile/birthDate.ts';

test('rejects invalid calendar values without normalizing them into another date', () => {
  for (const raw of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-00-18', '2026-13-18', '2026-06-00', '2026-6-18', '0999-12-31', '2026-06-18T00:00:00']) {
    assert.equal(isCalendarDate(raw), false, raw);
  }
});
test('accepts storage minimum and Gregorian leap days', () => {
  for (const raw of ['1000-01-01', '1995-06-18', '2024-02-29', '2000-02-29']) assert.equal(isCalendarDate(raw), true, raw);
  assert.equal(isCalendarDate('1900-02-29'), false);
});
