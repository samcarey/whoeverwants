"""Real, documented ranked-ballot scenarios for the aggregation comparison.

Sourced from the social-test suite (social_tests/tests/test_ranked_preferences.py)
plus a few sharper friend-group cases that put the IRV-vs-consensus divergence
front and centre — the exact UX hazard documented in
social_tests/testing_strategy.md, Key finding #7.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Scenario:
    key: str
    title: str
    blurb: str
    options: list[str]
    # (voter_name, ranking) — ranking is a flat best->worst list
    ballots: list[tuple[str, list[str]]]
    source: str

    @property
    def rankings(self) -> list[list[str]]:
        return [r for _, r in self.ballots]


SCENARIOS: list[Scenario] = [
    Scenario(
        key="consensus_favorite",
        title="Movie night — a clear consensus pick",
        blurb=(
            "Dune is everyone's #1 or #2 even though first-place votes are "
            "split. The sanity check: when there IS a broadly-loved option, "
            "every method should agree."
        ),
        options=["Dune", "Barbie", "Oppenheimer", "Spider-Verse"],
        ballots=[
            ("Elena", ["Dune", "Barbie", "Oppenheimer", "Spider-Verse"]),
            ("Marcus", ["Dune", "Oppenheimer", "Spider-Verse", "Barbie"]),
            ("Priya", ["Barbie", "Dune", "Spider-Verse", "Oppenheimer"]),
            ("Jordan", ["Oppenheimer", "Dune", "Barbie", "Spider-Verse"]),
            ("Nia", ["Dune", "Spider-Verse", "Oppenheimer", "Barbie"]),
        ],
        source="test_ranked_preferences.py::test_clear_favorite",
    ),
    Scenario(
        key="condorcet_compromise",
        title="Movie genre — the polarized group with a compromise",
        blurb=(
            "THE marquee case (testing_strategy.md #7). Half want Action, half "
            "want RomCom, and the Dramedy is literally everyone's #2 — the "
            "'thing nobody hates'. IRV eliminates Dramedy FIRST (fewest #1s) "
            "and crowns a polarizing plurality winner."
        ),
        options=["Action Blockbuster", "Romantic Comedy", "Dramedy"],
        ballots=[
            ("Alex", ["Action Blockbuster", "Dramedy", "Romantic Comedy"]),
            ("Blake", ["Action Blockbuster", "Dramedy", "Romantic Comedy"]),
            ("Casey", ["Action Blockbuster", "Dramedy", "Romantic Comedy"]),
            ("Dana", ["Romantic Comedy", "Dramedy", "Action Blockbuster"]),
            ("Ellis", ["Romantic Comedy", "Dramedy", "Action Blockbuster"]),
            ("Finley", ["Romantic Comedy", "Dramedy", "Action Blockbuster"]),
            ("Gray", ["Dramedy", "Romantic Comedy", "Action Blockbuster"]),
        ],
        source="test_ranked_preferences.py::test_condorcet_scenario",
    ),
    Scenario(
        key="restaurant_least_objectionable",
        title="Dinner — the place nobody objects to",
        blurb=(
            "A friend group of 7. Two cliques each have a strong favorite "
            "(Sushi, BBQ) that the OTHER clique ranks dead last. Thai is "
            "everyone's safe middle. This is the 'so are we doing Friday??' "
            "decision the app exists to settle — does the headline pick the "
            "place half the group can't stand, or the one they can all live with?"
        ),
        options=["Sushi Bar", "BBQ Joint", "Thai Place"],
        ballots=[
            ("Ana", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
            ("Ben", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
            ("Cleo", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
            ("Dev", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
            ("Esha", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
            ("Finn", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
            ("Gus", ["Thai Place", "Sushi Bar", "BBQ Joint"]),
        ],
        source="prototype (friend-group restaurant)",
    ),
    Scenario(
        key="spoiler_split",
        title="Movie pick — vote-splitting between similar options",
        blurb=(
            "Two sci-fi films split the sci-fi vote 4 ways while one comedy "
            "leads on #1s. IRV's strength: it consolidates the sci-fi vote "
            "after dropping the weaker sci-fi. Here IRV and consensus methods "
            "should mostly agree — IRV already fixes plurality's spoiler."
        ),
        options=["Dune", "Interstellar", "Mean Girls"],
        ballots=[
            ("Ada", ["Dune", "Interstellar", "Mean Girls"]),
            ("Ben", ["Dune", "Interstellar", "Mean Girls"]),
            ("Cy", ["Interstellar", "Dune", "Mean Girls"]),
            ("Di", ["Interstellar", "Dune", "Mean Girls"]),
            ("Ed", ["Mean Girls", "Interstellar", "Dune"]),
            ("Fi", ["Mean Girls", "Dune", "Interstellar"]),
            ("Gi", ["Mean Girls", "Interstellar", "Dune"]),
        ],
        source="test_ranked_preferences.py::test_spoiler_effect",
    ),
    Scenario(
        key="three_way_borda",
        title="Team retreat — a perfect 3-way first-place tie",
        blurb=(
            "9 people, 3 places, each with exactly 3 first-place votes. Mountain "
            "Lodge is everyone's 1st-or-2nd. Production IRV already breaks this "
            "with Borda, so it should land on the consensus pick too."
        ),
        options=["Lake House", "Mountain Lodge", "Beach Resort"],
        ballots=[
            ("Lake1", ["Lake House", "Mountain Lodge", "Beach Resort"]),
            ("Lake2", ["Lake House", "Mountain Lodge", "Beach Resort"]),
            ("Lake3", ["Lake House", "Mountain Lodge", "Beach Resort"]),
            ("Mtn1", ["Mountain Lodge", "Lake House", "Beach Resort"]),
            ("Mtn2", ["Mountain Lodge", "Lake House", "Beach Resort"]),
            ("Mtn3", ["Mountain Lodge", "Lake House", "Beach Resort"]),
            ("Beach1", ["Beach Resort", "Mountain Lodge", "Lake House"]),
            ("Beach2", ["Beach Resort", "Mountain Lodge", "Lake House"]),
            ("Beach3", ["Beach Resort", "Mountain Lodge", "Lake House"]),
        ],
        source="test_ranked_preferences.py::test_borda_tiebreaker",
    ),
    Scenario(
        key="ten_cuisines",
        title="Team dinner — 10 cuisines, 8 diners, partial ballots",
        blurb=(
            "A messy real ballot: lots of options, everyone ranks only their "
            "top 5. Thai is a near-universal high pick. Tests whether the "
            "methods agree when ballots are long and partial."
        ),
        options=[
            "Italian", "Thai", "Mexican", "Indian", "Chinese",
            "Japanese", "Korean", "Ethiopian", "Greek", "American",
        ],
        ballots=[
            ("D1", ["Italian", "Thai", "Mexican", "Indian", "Chinese"]),
            ("D2", ["Thai", "Japanese", "Korean", "Italian", "Ethiopian"]),
            ("D3", ["Mexican", "Italian", "American", "Thai", "Greek"]),
            ("D4", ["Indian", "Thai", "Italian", "Ethiopian", "Korean"]),
            ("D5", ["Thai", "Italian", "Japanese", "Chinese", "Greek"]),
            ("D6", ["Korean", "Japanese", "Thai", "Italian", "Chinese"]),
            ("D7", ["Ethiopian", "Indian", "Thai", "Italian", "Greek"]),
            ("D8", ["American", "Mexican", "Italian", "Thai", "Chinese"]),
        ],
        source="test_ranked_preferences.py::test_ten_option_ranked_choice",
    ),
]
