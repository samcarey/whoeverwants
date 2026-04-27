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

    def test_single_with_context(self):
        assert (
            generate_poll_title(["restaurant"], "Birthday")
            == "Restaurant for Birthday"
        )

    def test_single_with_context_strips_whitespace(self):
        assert (
            generate_poll_title(["movie"], "  Friday Night  ")
            == "Movie for Friday Night"
        )


class TestMultipleQuestions:
    def test_two_no_context(self):
        assert (
            generate_poll_title(["restaurant", "time"], None)
            == "Restaurant and Time"
        )

    def test_three_no_context(self):
        assert (
            generate_poll_title(["restaurant", "time", "movie"], None)
            == "Restaurant, Time, and Movie"
        )

    def test_two_with_context(self):
        assert (
            generate_poll_title(["restaurant", "time"], "Birthday")
            == "Restaurant and Time for Birthday"
        )

    def test_three_with_context(self):
        assert (
            generate_poll_title(
                ["restaurant", "time", "movie"], "Friday"
            )
            == "Restaurant, Time, and Movie for Friday"
        )

    def test_videogame_label(self):
        assert (
            generate_poll_title(["videogame", "time"], None)
            == "Video Game and Time"
        )

    def test_petname_label(self):
        assert (
            generate_poll_title(["petname"], "Cat")
            == "Pet Name for Cat"
        )


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
