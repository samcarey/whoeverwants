import { describe, it, expect } from 'vitest';
import { fitWindowsToBounds, hasInvalidVoterWindows } from '@/lib/timeUtils';

type W = { min: string; max: string };
const allowed: W[] = [{ min: '09:00', max: '12:00' }];

describe('fitWindowsToBounds', () => {
  it('is a no-op (same ref) when windows already fit', () => {
    const windows: W[] = [{ min: '09:30', max: '11:00' }];
    const r = fitWindowsToBounds(windows, allowed);
    expect(r.changed).toBe(false);
    expect(r.windows).toBe(windows);
  });

  it('clamps a window that overflows the allowed window', () => {
    // Bulk-edit set this to 10:00–14:00 but the day only allows until 12:00.
    const r = fitWindowsToBounds([{ min: '10:00', max: '14:00' }], allowed);
    expect(r.changed).toBe(true);
    expect(r.windows).toEqual([{ min: '10:00', max: '12:00' }]);
  });

  it('snaps a fully-outside window into the nearest allowed window, preserving duration', () => {
    // 20:00–22:00 (2h) overlaps nothing → snap to the end of 09:00–12:00.
    const r = fitWindowsToBounds([{ min: '20:00', max: '22:00' }], allowed);
    expect(r.changed).toBe(true);
    expect(r.windows).toEqual([{ min: '10:00', max: '12:00' }]);
  });

  it('merges overlapping windows after fitting', () => {
    const r = fitWindowsToBounds(
      [{ min: '09:00', max: '11:00' }, { min: '10:00', max: '12:00' }],
      allowed,
    );
    expect(r.changed).toBe(true);
    expect(r.windows).toEqual([{ min: '09:00', max: '12:00' }]);
  });

  it('with no allowed windows (creator form) only de-overlaps', () => {
    const r = fitWindowsToBounds(
      [{ min: '09:00', max: '11:00' }, { min: '15:00', max: '18:00' }],
      [],
    );
    expect(r.changed).toBe(false);
    const overlap = fitWindowsToBounds(
      [{ min: '09:00', max: '12:00' }, { min: '11:00', max: '14:00' }],
      [],
    );
    expect(overlap.windows).toEqual([{ min: '09:00', max: '14:00' }]);
  });

  it('output never trips the submit-blocker', () => {
    const day = '2026-06-12';
    const questionDays = [{ day, windows: allowed }];
    const fixed = fitWindowsToBounds(
      [{ min: '10:00', max: '14:00' }, { min: '08:00', max: '13:00' }],
      allowed,
    );
    expect(hasInvalidVoterWindows([{ day, windows: fixed.windows }], questionDays)).toBe(false);
  });
});
