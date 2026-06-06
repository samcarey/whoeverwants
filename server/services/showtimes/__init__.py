"""Showtime data layer.

Joins Alamo Drafthouse's two unauthenticated JSON feeds (legacy sessions +
modern catalog) with a static cinema directory (coords/timezone) to produce a
normalized, radius-filterable showtime catalog for the `showtime` poll type.

Alamo has no official API; the feeds are a *tolerated public feed*, not
sanctioned API access — fetch politely, cache hard (per-market once/day), expect
breakage. `ShowtimeSource` is the seam for adding other chains later.
"""

from .alamo import AlamoShowtimeSource, Showtime, ShowtimeSource, load_directory

__all__ = ["AlamoShowtimeSource", "Showtime", "ShowtimeSource", "load_directory"]
