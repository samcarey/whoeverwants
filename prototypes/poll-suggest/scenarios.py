"""Realistic (group history, user history) scenarios for evaluating AI poll
suggestions. Each poll is a dict with the same keys gather_history reads from the
DB (title / question_type / category / options / details), so the eval exercises
the REAL prompt-formatting + validation path with no database.

`details` is the per-question context (the "for X" subject). `title` is the
yes_no prompt / generic title. Keep these grounded in how real groups behave so
the LLM's predictions can be judged against plausible "what comes next".
"""
from __future__ import annotations


def _r(title="", *, qtype="ranked_choice", category="custom", options=None, details=""):
    return {
        "title": title,
        "question_type": qtype,
        "category": category,
        "options": options,
        "details": details,
    }


SCENARIOS: list[dict] = [
    {
        "name": "Foodie friend group (heavy restaurant history)",
        "group_polls": [
            _r(category="restaurant", details="Friday dinner", options=["Chipotle", "Sweetgreen", "Thai Basil"]),
            _r(category="restaurant", details="brunch", options=["Snooze", "First Watch"]),
            _r("Rooftop bar after?", qtype="yes_no"),
            _r(category="restaurant", details="taco tuesday"),
            _r(category="location", details="weekend hike", options=["Mt. Sanitas", "Chautauqua"]),
        ],
        "user_polls": [
            _r(category="restaurant", details="date night", options=["Frasca", "Tangerine"]),
            _r(category="restaurant", details="lunch"),
            _r("Should we get dessert?", qtype="yes_no"),
        ],
    },
    {
        "name": "Work team (yes/no decisions + scheduling)",
        "group_polls": [
            _r("Should we move standup to 9:30?", qtype="yes_no"),
            _r(qtype="time", category="time", details="sprint retro"),
            _r("Do we need a design review this week?", qtype="yes_no"),
            _r(qtype="time", category="time", details="team offsite"),
            _r("Approve the new logo?", qtype="yes_no"),
        ],
        "user_polls": [
            _r("Should we adopt the new linter?", qtype="yes_no"),
            _r(qtype="time", category="time", details="1:1 reschedule"),
        ],
    },
    {
        "name": "Gaming group (video games + scheduling)",
        "group_polls": [
            _r(category="video_game", details="game night", options=["Smash Bros", "Mario Kart", "Overcooked"]),
            _r(qtype="time", category="time", details="game night"),
            _r(category="video_game", details="co-op", options=["It Takes Two", "Helldivers 2"]),
            _r("Should we do a tournament?", qtype="yes_no"),
        ],
        "user_polls": [
            _r(category="video_game", details="weekend session"),
            _r(category="movie", details="break", options=["Dune 2", "Oppenheimer"]),
        ],
    },
    {
        "name": "Event planning group (mixed time + place + food)",
        "group_polls": [
            _r(qtype="time", category="time", details="birthday party"),
            _r(category="location", details="party venue", options=["The Loft", "Backyard", "Bowling alley"]),
            _r(category="restaurant", details="catering", options=["Pizza", "Tacos", "BBQ"]),
            _r("Should we do a gift pool?", qtype="yes_no"),
            _r("Concert tickets — who's in?", qtype="limited_supply", category="limited_supply", details="Concert tickets"),
        ],
        "user_polls": [
            _r(qtype="time", category="time", details="game night"),
            _r(category="restaurant", details="dinner"),
        ],
    },
    {
        "name": "New member, established group (no user history)",
        "group_polls": [
            _r(category="movie", details="movie night", options=["Barbie", "Past Lives", "Spider-Verse"]),
            _r(qtype="time", category="time", details="movie night"),
            _r(category="restaurant", details="dinner before movie"),
            _r("Should we make it a weekly thing?", qtype="yes_no"),
        ],
        "user_polls": [],
    },
    {
        "name": "Active user, brand-new empty group (no group history)",
        "group_polls": [],
        "user_polls": [
            _r(category="restaurant", details="dinner", options=["Ramen", "Sushi"]),
            _r(qtype="time", category="time", details="hangout"),
            _r("Should we carpool?", qtype="yes_no"),
            _r(category="location", details="weekend trip"),
        ],
    },
    {
        "name": "Roommates (chores + household yes/no + supplies)",
        "group_polls": [
            _r("Should we get a cleaning service?", qtype="yes_no"),
            _r(category="custom", details="chore rotation", options=["Dishes", "Trash", "Bathroom"]),
            _r("Extra concert ticket — anyone?", qtype="limited_supply", category="limited_supply", details="Concert ticket"),
            _r(qtype="time", category="time", details="apartment deep clean"),
        ],
        "user_polls": [
            _r("Should we split a Costco membership?", qtype="yes_no"),
        ],
    },
]
