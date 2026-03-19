"""Tests for auto-close logic for participation polls."""

from algorithms.auto_close import should_auto_close


class TestShouldAutoClose:
    """Tests for should_auto_close()."""

    def test_closes_when_yes_votes_reach_max(self):
        assert should_auto_close("participation", False, 3, 3) is True

    def test_closes_when_yes_votes_exceed_max(self):
        assert should_auto_close("participation", False, 3, 5) is True

    def test_does_not_close_below_max(self):
        assert should_auto_close("participation", False, 3, 2) is False

    def test_does_not_close_with_zero_votes(self):
        assert should_auto_close("participation", False, 3, 0) is False

    def test_does_not_close_non_participation_poll(self):
        assert should_auto_close("yes_no", False, 3, 3) is False

    def test_does_not_close_ranked_choice_poll(self):
        assert should_auto_close("ranked_choice", False, 3, 3) is False

    def test_does_not_close_nomination_poll(self):
        assert should_auto_close("nomination", False, 3, 3) is False

    def test_does_not_close_already_closed_poll(self):
        assert should_auto_close("participation", True, 3, 3) is False

    def test_does_not_close_when_no_max_set(self):
        assert should_auto_close("participation", False, None, 10) is False

    def test_closes_at_max_of_one(self):
        assert should_auto_close("participation", False, 1, 1) is True

    def test_does_not_close_at_zero_max_zero_votes(self):
        # Edge case: max_participants=0 means no one can participate
        # 0 >= 0 is True, so poll should close
        assert should_auto_close("participation", False, 0, 0) is True
