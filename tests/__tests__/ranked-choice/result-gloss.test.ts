import { describe, it, expect } from 'vitest';
import { rankedChoiceResultGloss } from '@/lib/rankedChoiceGloss';
import type { QuestionResults, RankedChoiceRound } from '@/lib/types';

// Minimal RankedChoiceRound factory — the gloss only reads round_number,
// option_name, and is_eliminated.
function round(roundNumber: number, optionName: string, eliminated: boolean): RankedChoiceRound {
  return {
    id: `${roundNumber}-${optionName}`,
    question_id: 'q',
    round_number: roundNumber,
    option_name: optionName,
    vote_count: 0,
    is_eliminated: eliminated,
    created_at: '',
  };
}

function results(partial: Partial<QuestionResults>): QuestionResults {
  return {
    question_id: 'q',
    title: 'T',
    question_type: 'ranked_choice',
    created_at: '',
    total_votes: 9,
    ...partial,
  };
}

describe('rankedChoiceResultGloss', () => {
  it('flags a broadly-acceptable option that IRV eliminated early (warn)', () => {
    // Classic compromise scenario: C wins by first-choices, but B (everyone's
    // #2) was on more ballots overall (Borda 20 > C's 17) and got knocked out
    // in round 1 for having the fewest first picks.
    const g = rankedChoiceResultGloss(
      results({
        winner: 'C',
        borda_scores: { A: 17, B: 20, C: 17 },
        ranked_choice_rounds: [
          round(1, 'A', false),
          round(1, 'C', false),
          round(1, 'B', true),
          round(2, 'A', false),
          round(2, 'C', false),
        ],
      }),
    );
    expect(g?.tone).toBe('warn');
    expect(g?.text).toContain('B');
    expect(g?.text).toContain('C');
  });

  it('gives a neutral how-it-was-decided gloss for a multi-round result with no compromise loser (info)', () => {
    const g = rankedChoiceResultGloss(
      results({
        winner: 'A',
        borda_scores: { A: 20, B: 12, C: 10 },
        ranked_choice_rounds: [
          round(1, 'A', false),
          round(1, 'B', false),
          round(1, 'C', true),
          round(2, 'A', false),
          round(2, 'B', false),
        ],
      }),
    );
    expect(g?.tone).toBe('info');
    expect(g?.text).toContain('2 rounds');
  });

  it('returns null for a single-round majority (self-explanatory)', () => {
    const g = rankedChoiceResultGloss(
      results({
        winner: 'A',
        borda_scores: { A: 18, B: 9 },
        ranked_choice_rounds: [round(1, 'A', false), round(1, 'B', false)],
      }),
    );
    expect(g).toBeNull();
  });

  it('returns null when there is no winner or a tie', () => {
    expect(rankedChoiceResultGloss(results({ winner: undefined }))).toBeNull();
    expect(
      rankedChoiceResultGloss(
        results({ winner: 'tie', ranked_choice_rounds: [round(1, 'A', false)] }),
      ),
    ).toBeNull();
  });

  it('does not flag an equal-Borda eliminated option (strictly-greater only)', () => {
    // B is eliminated and ties the winner on Borda — not "more broadly
    // accepted", so no warn; falls through to the multi-round info gloss.
    const g = rankedChoiceResultGloss(
      results({
        winner: 'C',
        borda_scores: { A: 10, B: 17, C: 17 },
        ranked_choice_rounds: [
          round(1, 'A', false),
          round(1, 'C', false),
          round(1, 'B', true),
          round(2, 'A', false),
          round(2, 'C', false),
        ],
      }),
    );
    expect(g?.tone).toBe('info');
  });
});
