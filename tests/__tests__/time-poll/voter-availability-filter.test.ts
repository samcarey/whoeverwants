import { describe, it, expect } from 'vitest';
import { isVoterAvailableForSlot } from '@/lib/timeUtils';

type Dtw = { day: string; windows?: Array<{ min: string; max: string }> };

describe('isVoterAvailableForSlot', () => {
  it('returns true when the slot falls inside a voter window', () => {
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '09:00', max: '17:00' }] }];
    expect(isVoterAvailableForSlot('2026-04-18 10:00-11:00', voter)).toBe(true);
  });

  it('returns false when the slot extends past the voter window', () => {
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '09:00', max: '12:00' }] }];
    expect(isVoterAvailableForSlot('2026-04-18 11:30-13:00', voter)).toBe(false);
  });

  it('returns false when the voter has no window for that day', () => {
    const voter: Dtw[] = [{ day: '2026-04-19', windows: [{ min: '09:00', max: '17:00' }] }];
    expect(isVoterAvailableForSlot('2026-04-18 10:00-11:00', voter)).toBe(false);
  });

  it('treats a day with empty windows as all-day available', () => {
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [] }];
    expect(isVoterAvailableForSlot('2026-04-18 03:00-04:00', voter)).toBe(true);
  });

  it('handles cross-midnight voter windows (22:00-02:00)', () => {
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '22:00', max: '02:00' }] }];
    expect(isVoterAvailableForSlot('2026-04-18 23:00-01:00', voter)).toBe(true);
    expect(isVoterAvailableForSlot('2026-04-18 22:00-23:00', voter)).toBe(true);
  });

  it('rejects slots that cross outside a cross-midnight window', () => {
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '22:00', max: '02:00' }] }];
    expect(isVoterAvailableForSlot('2026-04-18 01:30-03:00', voter)).toBe(false);
  });

  it('matches when any of multiple windows on the same day covers the slot', () => {
    const voter: Dtw[] = [{
      day: '2026-04-18',
      windows: [
        { min: '09:00', max: '10:00' },
        { min: '14:00', max: '17:00' },
      ],
    }];
    expect(isVoterAvailableForSlot('2026-04-18 15:00-16:00', voter)).toBe(true);
    expect(isVoterAvailableForSlot('2026-04-18 11:00-12:00', voter)).toBe(false);
  });

  it('returns false for an empty voter availability list', () => {
    expect(isVoterAvailableForSlot('2026-04-18 10:00-11:00', [])).toBe(false);
  });
});

describe('filtering generated slots by voter availability (preference phase)', () => {
  // Mirrors the logic used in SubPollBallot.preferenceSlotsForVoter:
  // only present slots the voter said they were available for.
  const filter = (slots: string[], voter: Dtw[]) =>
    slots.filter(s => isVoterAvailableForSlot(s, voter));

  it('hides slots the voter said they are not available for', () => {
    const slots = [
      '2026-04-18 09:00-10:00',
      '2026-04-18 10:00-11:00',
      '2026-04-18 14:00-15:00',
      '2026-04-18 19:00-20:00',
    ];
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '09:00', max: '12:00' }] }];
    expect(filter(slots, voter)).toEqual([
      '2026-04-18 09:00-10:00',
      '2026-04-18 10:00-11:00',
    ]);
  });

  it('hides slots on days the voter did not select', () => {
    const slots = [
      '2026-04-18 10:00-11:00',
      '2026-04-19 10:00-11:00',
      '2026-04-20 10:00-11:00',
    ];
    const voter: Dtw[] = [{ day: '2026-04-19', windows: [{ min: '09:00', max: '17:00' }] }];
    expect(filter(slots, voter)).toEqual(['2026-04-19 10:00-11:00']);
  });

  it('returns no slots when voter availability does not overlap any option', () => {
    const slots = ['2026-04-18 14:00-15:00', '2026-04-18 15:00-16:00'];
    const voter: Dtw[] = [{ day: '2026-04-18', windows: [{ min: '09:00', max: '11:00' }] }];
    expect(filter(slots, voter)).toEqual([]);
  });
});
