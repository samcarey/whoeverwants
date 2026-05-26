import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBrowserId,
  adoptServerBrowserId,
  _resetBrowserIdForTests,
} from '@/lib/browserIdentity';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const REAL_UUID = '11111111-2222-4333-8444-555555555555';
const STORAGE_KEY = 'browser_id';

describe('browserIdentity nil-UUID handling', () => {
  beforeEach(() => {
    _resetBrowserIdForTests();
  });

  it('treats a stored nil UUID as no identity and drops it', () => {
    // beforeEach reset cached to undefined, so getBrowserId reads storage fresh.
    localStorage.setItem(STORAGE_KEY, NIL_UUID);
    expect(getBrowserId()).toBeNull();
    // The corrupted value is purged so it can't be re-sent.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores a server-echoed nil UUID', () => {
    adoptServerBrowserId(NIL_UUID);
    expect(getBrowserId()).toBeNull();
  });

  it('self-heals: adopts a real id after a stored nil is discarded', () => {
    localStorage.setItem(STORAGE_KEY, NIL_UUID);
    expect(getBrowserId()).toBeNull(); // nil discarded
    adoptServerBrowserId(REAL_UUID);
    expect(getBrowserId()).toBe(REAL_UUID);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REAL_UUID);
  });

  it('accepts and persists a valid server-minted id', () => {
    adoptServerBrowserId(REAL_UUID);
    expect(getBrowserId()).toBe(REAL_UUID);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REAL_UUID);
  });

  it('first-write wins for a real stored id (does not adopt a different one)', () => {
    adoptServerBrowserId(REAL_UUID);
    adoptServerBrowserId('99999999-8888-4777-8666-555555555555');
    expect(getBrowserId()).toBe(REAL_UUID);
  });
});
