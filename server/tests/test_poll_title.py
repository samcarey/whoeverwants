"""Tests for the poll auto-title generator."""

from algorithms.poll_title import generate_poll_title


class TestSingleQuestion:
    def test_yes_no_no_context(self):
        assert generate_poll_title(["yes_no"], None) == "Yes/No?"

    def test_time_no_context(self):
        assert generate_poll_title(["time"], None) == "Time?"

    def test_restaurant_no_context(self):
        assert generate_poll_title(["restaurant"], None) == "Restaurant?"

    def test_unknown_category_no_context(self):
        # Unknown category falls back to title-cased raw string + "?"
        assert generate_poll_title(["dessert"], None) == "Dessert?"

    def test_single_with_poll_context(self):
        assert (
            generate_poll_title(["restaurant"], "Birthday")
            == "Restaurant for Birthday"
        )

    def test_single_with_question_context(self):
        # No poll-level context, but the question itself has one — for a
        # 1-question poll the title should match the question's own title.
        assert (
            generate_poll_title(["restaurant"], None, ["Tonight"])
            == "Restaurant for Tonight"
        )

    def test_single_poll_context_overrides_question_context(self):
        assert (
            generate_poll_title(["restaurant"], "Birthday", ["Tonight"])
            == "Restaurant for Birthday"
        )

    def test_single_with_context_strips_whitespace(self):
        assert (
            generate_poll_title(["movie"], "  Friday Night  ")
            == "Movie for Friday Night"
        )


class TestMultipleQuestions:
    def test_two_no_context(self):
        # No context anywhere — comma-join category labels.
        assert (
            generate_poll_title(["restaurant", "time"], None)
            == "Restaurant, Time"
        )

    def test_three_no_context(self):
        assert (
            generate_poll_title(["restaurant", "time", "movie"], None)
            == "Restaurant, Time, Movie"
        )

    def test_two_with_poll_context(self):
        assert (
            generate_poll_title(["restaurant", "time"], "Birthday")
            == "Restaurant, Time for Birthday"
        )

    def test_two_with_shared_question_context(self):
        # All questions share the same per-question context — collapses to
        # the same form as a poll-level context.
        assert (
            generate_poll_title(
                ["restaurant", "movie"], None, ["Tonight", "Tonight"]
            )
            == "Restaurant, Movie for Tonight"
        )

    def test_shared_context_case_insensitive(self):
        assert (
            generate_poll_title(
                ["restaurant", "movie"], None, ["tonight", "Tonight"]
            )
            == "Restaurant, Movie for tonight"
        )

    def test_three_with_poll_context(self):
        assert (
            generate_poll_title(
                ["restaurant", "time", "movie"], "Friday"
            )
            == "Restaurant, Time, Movie for Friday"
        )

    def test_videogame_label(self):
        assert (
            generate_poll_title(["videogame", "time"], None)
            == "Video Game, Time"
        )

    def test_petname_label(self):
        assert (
            generate_poll_title(["petname"], "Cat")
            == "Pet Name for Cat"
        )

    def test_distinct_question_contexts_joined(self):
        # Different per-question short contexts that fit on one line: list
        # each "Cat for Ctx" pair without truncation.
        assert (
            generate_poll_title(
                ["movie", "petname"], None, ["Tom", "Cat"]
            )
            == "Movie for Tom, Pet Name for Cat"
        )

    def test_distinct_question_contexts_overflow_appends_etc(self):
        # When the second pair would push us over the line, list the first
        # one and append ", etc."
        assert (
            generate_poll_title(
                ["restaurant", "movie"], None, ["Tonight", "Tomorrow"]
            )
            == "Restaurant for Tonight, etc."
        )

    def test_distinct_contexts_etc_when_too_long(self):
        title = generate_poll_title(
            ["restaurant", "movie", "videogame", "petname"],
            None,
            ["Tonight", "Tomorrow", "Friday", "Saturday"],
        )
        # Should land on the first one or two pairs, then ", etc." tacked on.
        assert title.endswith(", etc.")
        assert title.startswith("Restaurant for Tonight")
        assert len(title) <= 40 + len(", etc.")

    def test_partial_question_contexts_treated_as_distinct(self):
        # When some questions have a context and others don't, they are NOT
        # all aligned, so they don't collapse to a shared "for X" suffix.
        title = generate_poll_title(
            ["restaurant", "movie"], None, ["Tonight", None]
        )
        assert title == "Restaurant for Tonight, Movie"


class TestLongTitleFallback:
    def test_falls_back_to_questions_for_x_when_overflow(self):
        # Many categories + a long context overflow the 40-char cap so we
        # collapse to "Questions for X".
        cats = ["restaurant", "movie", "videogame", "petname"]
        title = generate_poll_title(cats, "the engagement weekend")
        assert title == "Questions for the engagement weekend"

    def test_shared_question_context_overflow(self):
        cats = ["restaurant", "movie", "videogame", "petname"]
        contexts = ["Trip"] * 4
        # "Restaurant, Movie, Video Game, Pet Name for Trip" = 48 chars
        title = generate_poll_title(cats, None, contexts)
        assert title == "Questions for Trip"

    def test_just_under_limit_keeps_full_form(self):
        # "Restaurant, Time, Movie for Birthday" = 36 chars
        title = generate_poll_title(["restaurant", "time", "movie"], "Birthday")
        assert title == "Restaurant, Time, Movie for Birthday"


class TestEdgeCases:
    def test_empty_list_no_context(self):
        assert generate_poll_title([], None) == "Question?"

    def test_empty_list_with_context(self):
        assert generate_poll_title([], "Birthday") == "Birthday"

    def test_blank_categories_filtered(self):
        assert (
            generate_poll_title(["", "  ", "restaurant"], None)
            == "Restaurant?"
        )

    def test_blank_context_treated_as_none(self):
        assert generate_poll_title(["restaurant"], "   ") == "Restaurant?"

    def test_yes_slash_no_alias(self):
        assert generate_poll_title(["yes/no"], None) == "Yes/No?"

    def test_blank_question_contexts_treated_as_none(self):
        # All-empty per-question contexts behave like None.
        assert (
            generate_poll_title(["restaurant", "movie"], None, ["", "  "])
            == "Restaurant, Movie"
        )

    def test_question_contexts_padded_when_shorter_than_categories(self):
        # Defensive: callers shouldn't be required to send a context per
        # question — short lists pad with None.
        assert (
            generate_poll_title(["restaurant", "movie"], None, ["Tonight"])
            == "Restaurant for Tonight, Movie"
        )
