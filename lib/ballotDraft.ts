// Ballot draft persistence — saves in-progress vote state to localStorage
// so it survives page navigation. Keyed by poll ID.

const PREFIX = 'ballotDraft:';

export interface BallotDraft {
  yesNoChoice?: 'yes' | 'no' | null;
  isAbstaining?: boolean;
  voterMinParticipants?: number | null;
  voterMaxParticipants?: number | null;
  voterMaxEnabled?: boolean;
  voterDayTimeWindows?: any[];
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
}

export function loadBallotDraft(pollId: string): BallotDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFIX + pollId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveBallotDraft(pollId: string, draft: BallotDraft): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + pollId, JSON.stringify(draft));
  } catch { /* ignore quota errors */ }
}

export function clearBallotDraft(pollId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PREFIX + pollId);
  } catch { /* ignore */ }
}
