import { describe, it, expect } from 'vitest';
import { pickNextTimeWindow } from '@/lib/timeUtils';

type Day = { day: string; windows: Array<{ min: string; max: string }> };

describe('pickNextTimeWindow', () => {
  it('falls back to the 8 AM – 5 PM default when only the target day exists', () => {
    const days: Day[] = [{ day: '2026-05-15', windows: [{ min: '09:00', max: '12:00' }] }];
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '08:00', max: '17:00' });
  });

  it('copies the latest non-intersecting slot from the immediate previous day', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '09:00', max: '12:00' }, { min: '14:00', max: '17:00' }] },
      { day: '2026-05-15', windows: [{ min: '10:00', max: '11:00' }] },
    ];
    // Latest of prev day = 14:00–17:00, doesn't overlap target's 10–11.
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '14:00', max: '17:00' });
  });

  it('skips intersecting slots and picks the next-latest that fits', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '09:00', max: '12:00' }, { min: '13:00', max: '16:00' }] },
      { day: '2026-05-15', windows: [{ min: '14:00', max: '17:00' }] },
    ];
    // 13–16 overlaps target's 14–17 → try earlier slot 09–12 (no overlap).
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '09:00', max: '12:00' });
  });

  it('walks back through multiple previous days when the immediate previous has nothing usable', () => {
    const days: Day[] = [
      { day: '2026-05-12', windows: [{ min: '06:00', max: '08:00' }] },
      { day: '2026-05-13', windows: [{ min: '10:00', max: '12:00' }] }, // intersects target
      { day: '2026-05-14', windows: [{ min: '11:00', max: '12:00' }] }, // intersects target
      { day: '2026-05-15', windows: [{ min: '10:00', max: '13:00' }] },
    ];
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '06:00', max: '08:00' });
  });

  it('falls through to following days when no previous day yields a fit', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '09:00', max: '17:00' }] }, // intersects target
      { day: '2026-05-15', windows: [{ min: '09:00', max: '17:00' }] },
      { day: '2026-05-16', windows: [{ min: '18:00', max: '21:00' }] }, // fits
    ];
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '18:00', max: '21:00' });
  });

  it('prefers previous days over following days when both can supply a fit', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '06:00', max: '07:00' }] }, // fits
      { day: '2026-05-15', windows: [{ min: '10:00', max: '12:00' }] },
      { day: '2026-05-16', windows: [{ min: '18:00', max: '20:00' }] }, // also fits
    ];
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '06:00', max: '07:00' });
  });

  it('falls back to the default range when no day on either side has anything that fits', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '08:00', max: '17:00' }] },
      { day: '2026-05-15', windows: [{ min: '08:00', max: '17:00' }] },
      { day: '2026-05-16', windows: [{ min: '08:00', max: '17:00' }] },
    ];
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '08:00', max: '17:00' });
  });

  it('treats a target day with no existing windows as accepting any candidate', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '08:00', max: '10:00' }, { min: '12:00', max: '14:00' }] },
      { day: '2026-05-15', windows: [] },
    ];
    // No existing slots on target → latest of prev (12–14) fits trivially.
    expect(pickNextTimeWindow('2026-05-15', days)).toEqual({ min: '12:00', max: '14:00' });
  });

  it('returns a defensive copy so mutating the result does not affect the source', () => {
    const days: Day[] = [
      { day: '2026-05-14', windows: [{ min: '09:00', max: '12:00' }] },
      { day: '2026-05-15', windows: [] },
    ];
    const picked = pickNextTimeWindow('2026-05-15', days);
    picked.min = '00:00';
    expect(days[0].windows[0].min).toBe('09:00');
  });
});
