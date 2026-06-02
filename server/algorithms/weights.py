"""Vote weighting for the "plus one/more" feature.

A vote can represent the submitter plus N additional people (the optional
`plus_one_names` array on the row — one entry per represented person). The
ballot then counts as 1 + N voters everywhere results are tallied: yes/no
counts, ranked-choice IRV ballots, and time availability/preferences.

`plus_one_names` arrives as a JSON array (psycopg already decodes JSONB to a
Python list) or None. Entries may be empty strings (unnamed plus-ones); they
still count toward the weight.
"""


def vote_weight(vote: dict) -> int:
    """Number of people a single vote row counts for: 1 (submitter) + plus-ones.

    Tolerant of None / a non-list value (treats as no plus-ones), so a
    pre-migration-130 row with no `plus_one_names` weighs exactly 1.
    """
    names = vote.get("plus_one_names")
    if not isinstance(names, list):
        return 1
    return 1 + len(names)
