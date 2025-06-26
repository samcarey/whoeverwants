#!/usr/bin/env python3
"""
Comprehensive test suite for ranked choice voting system.

This test suite creates a temporary local database, runs migrations against it,
and tests the ranked choice voting algorithm by comparing database results
with local Python calculations.
"""

import os
import pytest
import psycopg2
from psycopg2.extras import RealDictCursor
import uuid
from typing import List, Dict, Tuple, Optional
from collections import defaultdict, Counter
import tempfile
import subprocess


class RankedChoiceCalculator:
    """
    Python implementation of Instant Runoff Voting (IRV) algorithm
    that matches the PostgreSQL implementation in the database.
    """
    
    def __init__(self, ballots: List[List[str]]):
        """
        Initialize with a list of ballots.
        Each ballot is a list of candidates in ranked order.
        """
        self.ballots = ballots
        self.total_ballots = len(ballots)
        self.majority_threshold = (self.total_ballots // 2) + 1
        
    def calculate_winner(self) -> Tuple[Optional[str], int, List[Dict]]:
        """
        Calculate the winner using IRV algorithm.
        
        Returns:
            Tuple of (winner, total_rounds, rounds_data)
            - winner: The winning candidate or None if no votes
            - total_rounds: Number of elimination rounds
            - rounds_data: List of round data for verification
        """
        if not self.ballots:
            return None, 0, []
            
        eliminated = set()
        rounds_data = []
        current_round = 1
        
        while current_round <= 50:  # Safety limit
            # Count votes for each candidate
            vote_counts = self._count_votes(eliminated)
            
            # Record round data
            round_info = {
                'round': current_round,
                'counts': dict(vote_counts),
                'eliminated': []
            }
            
            if not vote_counts:
                # No valid votes remain
                return None, current_round, rounds_data + [round_info]
            
            # Check for winner (majority or only one candidate left)
            max_votes = max(vote_counts.values())
            candidates_with_max = [c for c, v in vote_counts.items() if v == max_votes]
            
            if max_votes >= self.majority_threshold or len(vote_counts) == 1:
                winner = candidates_with_max[0]  # In case of tie, take first
                rounds_data.append(round_info)
                return winner, current_round, rounds_data
            
            # Find candidates to eliminate (all with minimum votes)
            min_votes = min(vote_counts.values())
            to_eliminate = [c for c, v in vote_counts.items() if v == min_votes]
            
            # Eliminate candidates
            eliminated.update(to_eliminate)
            round_info['eliminated'] = to_eliminate
            rounds_data.append(round_info)
            
            current_round += 1
            
        raise Exception("Ranked choice calculation exceeded maximum rounds")
    
    def _count_votes(self, eliminated: set) -> Counter:
        """Count votes for non-eliminated candidates."""
        counts = Counter()
        
        for ballot in self.ballots:
            # Find first non-eliminated candidate on this ballot
            for candidate in ballot:
                if candidate not in eliminated:
                    counts[candidate] += 1
                    break
                    
        return counts


class TestDatabase:
    """Manages test database setup and teardown."""
    
    def __init__(self):
        self.db_name = f"test_whoeverwants_{uuid.uuid4().hex[:8]}"
        self.conn = None
        self.migrations_dir = "/Users/sccarey/projects/personal/whoeverwants/database/migrations"
        self.pg_user = os.getenv("POSTGRES_USER", os.getenv("USER", "postgres"))
        
    def setup(self):
        """Create test database and run migrations."""
        # Connect to postgres to create test database
        conn = psycopg2.connect(
            host="localhost",
            database="postgres",
            user=self.pg_user,
            password=os.getenv("POSTGRES_PASSWORD", "")
        )
        conn.autocommit = True
        
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE {self.db_name}")
        
        conn.close()
        
        # Connect to test database
        self.conn = psycopg2.connect(
            host="localhost",
            database=self.db_name,
            user=self.pg_user,
            password=os.getenv("POSTGRES_PASSWORD", ""),
            cursor_factory=RealDictCursor
        )
        
        # Run migrations
        self._run_migrations()
        
    def teardown(self):
        """Clean up test database."""
        if self.conn:
            self.conn.close()
            
        # Drop test database
        conn = psycopg2.connect(
            host="localhost",
            database="postgres",
            user=self.pg_user,
            password=os.getenv("POSTGRES_PASSWORD", "")
        )
        conn.autocommit = True
        
        with conn.cursor() as cur:
            # Terminate any active connections to the test database
            cur.execute(f"""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = '{self.db_name}'
            """)
            cur.execute(f"DROP DATABASE {self.db_name}")
            
        conn.close()
        
    def _run_migrations(self):
        """Run all up migrations in order."""
        migration_files = []
        
        # Find all up migration files
        for filename in os.listdir(self.migrations_dir):
            if filename.endswith("_up.sql"):
                # Extract number for sorting
                try:
                    num = int(filename.split("_")[0])
                    migration_files.append((num, filename))
                except ValueError:
                    continue
                    
        # Sort by migration number
        migration_files.sort(key=lambda x: x[0])
        
        # Execute migrations
        with self.conn.cursor() as cur:
            for _, filename in migration_files:
                filepath = os.path.join(self.migrations_dir, filename)
                with open(filepath, 'r') as f:
                    sql = f.read()
                    cur.execute(sql)
                    
        self.conn.commit()
        
    def create_poll(self, title: str, options: List[str]) -> str:
        """Create a ranked choice poll and return its ID."""
        import json
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO polls (title, poll_type, options)
                VALUES (%s, 'ranked_choice', %s)
                RETURNING id
            """, (title, json.dumps(options)))
            
            poll_id = cur.fetchone()['id']
            self.conn.commit()
            return str(poll_id)
            
    def submit_ballot(self, poll_id: str, ranked_choices: List[str]):
        """Submit a ranked choice ballot."""
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO votes (poll_id, vote_type, ranked_choices)
                VALUES (%s, 'ranked_choice', %s)
            """, (poll_id, ranked_choices))
            
        self.conn.commit()
        
    def calculate_winner(self, poll_id: str) -> Tuple[Optional[str], int]:
        """Calculate winner using database function."""
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT winner, total_rounds 
                FROM calculate_ranked_choice_winner(%s)
            """, (poll_id,))
            
            result = cur.fetchone()
            return result['winner'], result['total_rounds']
            
    def get_round_data(self, poll_id: str) -> List[Dict]:
        """Get detailed round data from database."""
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT round_number, option_name, vote_count, is_eliminated
                FROM ranked_choice_rounds
                WHERE poll_id = %s
                ORDER BY round_number, vote_count DESC
            """, (poll_id,))
            
            return [dict(row) for row in cur.fetchall()]


@pytest.fixture
def test_db():
    """Pytest fixture for test database."""
    db = TestDatabase()
    db.setup()
    yield db
    db.teardown()


class TestRankedChoiceVoting:
    """Test suite for ranked choice voting algorithm."""
    
    def test_simple_majority_winner(self, test_db):
        """Test case where one candidate has clear majority in first round."""
        poll_id = test_db.create_poll("Simple Majority Test", ["Alice", "Bob", "Charlie"])
        
        # Submit ballots: Alice gets majority
        ballots = [
            ["Alice", "Bob", "Charlie"],  # Alice voters
            ["Alice", "Charlie", "Bob"],
            ["Alice", "Bob", "Charlie"],
            ["Bob", "Alice", "Charlie"],  # Bob voter
            ["Charlie", "Bob", "Alice"]   # Charlie voter
        ]
        
        for ballot in ballots:
            test_db.submit_ballot(poll_id, ballot)
            
        # Calculate with database
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        
        # Calculate with Python
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner == "Alice"
        assert db_rounds == py_rounds == 1
        
        # Verify detailed round data
        db_rounds_data = test_db.get_round_data(poll_id)
        expected_counts = {"Alice": 3, "Bob": 1, "Charlie": 1}
        
        for row in db_rounds_data:
            assert row['vote_count'] == expected_counts[row['option_name']]
            assert row['round_number'] == 1
            assert not row['is_eliminated']  # No eliminations in first round
            
    def test_elimination_rounds(self, test_db):
        """Test case requiring multiple elimination rounds."""
        poll_id = test_db.create_poll("Elimination Test", ["Alice", "Bob", "Charlie", "Dave"])
        
        # Create scenario requiring eliminations
        ballots = [
            ["Alice", "Bob", "Charlie", "Dave"],  # 3 Alice first
            ["Alice", "Charlie", "Bob", "Dave"],
            ["Alice", "Dave", "Bob", "Charlie"],
            ["Bob", "Alice", "Charlie", "Dave"],   # 3 Bob first
            ["Bob", "Charlie", "Alice", "Dave"],
            ["Bob", "Dave", "Alice", "Charlie"],
            ["Charlie", "Alice", "Bob", "Dave"],   # 2 Charlie first
            ["Charlie", "Bob", "Alice", "Dave"],
            ["Dave", "Alice", "Bob", "Charlie"]    # 1 Dave first (eliminated first)
        ]
        
        for ballot in ballots:
            test_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
        # Verify round progression
        db_rounds_data = test_db.get_round_data(poll_id)
        rounds_by_num = defaultdict(list)
        for row in db_rounds_data:
            rounds_by_num[row['round_number']].append(row)
            
        # Check that eliminations match Python calculation
        for round_num, py_round in enumerate(rounds_data, 1):
            db_round = rounds_by_num[round_num]
            
            # Verify vote counts match
            db_counts = {row['option_name']: row['vote_count'] for row in db_round}
            assert db_counts == py_round['counts']
            
            # Verify eliminations match
            db_eliminated = [row['option_name'] for row in db_round if row['is_eliminated']]
            assert set(db_eliminated) == set(py_round['eliminated'])
            
    def test_tie_elimination(self, test_db):
        """Test handling of ties in elimination."""
        poll_id = test_db.create_poll("Tie Elimination Test", ["Alice", "Bob", "Charlie", "Dave"])
        
        # Create tie scenario: Charlie and Dave both get 1 vote, should both be eliminated
        ballots = [
            ["Alice", "Bob", "Charlie", "Dave"],  # 2 Alice
            ["Alice", "Bob", "Dave", "Charlie"],
            ["Bob", "Alice", "Charlie", "Dave"],  # 2 Bob
            ["Bob", "Alice", "Dave", "Charlie"],
            ["Charlie", "Alice", "Bob", "Dave"],  # 1 Charlie
            ["Dave", "Alice", "Bob", "Charlie"]   # 1 Dave
        ]
        
        for ballot in ballots:
            test_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
        # Verify that tied candidates are both eliminated
        db_rounds_data = test_db.get_round_data(poll_id)
        first_round_eliminated = [
            row['option_name'] for row in db_rounds_data 
            if row['round_number'] == 1 and row['is_eliminated']
        ]
        
        # Both Charlie and Dave should be eliminated in first round
        assert set(first_round_eliminated) == {"Charlie", "Dave"}
        
    def test_no_votes(self, test_db):
        """Test handling of poll with no votes."""
        poll_id = test_db.create_poll("No Votes Test", ["Alice", "Bob", "Charlie"])
        
        # Don't submit any votes
        
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator([])
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Both should return None winner, 0 rounds
        assert db_winner == py_winner is None
        assert db_rounds == py_rounds == 0
        
    def test_single_vote(self, test_db):
        """Test handling of poll with single vote."""
        poll_id = test_db.create_poll("Single Vote Test", ["Alice", "Bob", "Charlie"])
        
        # Submit single ballot
        test_db.submit_ballot(poll_id, ["Bob", "Alice", "Charlie"])
        
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator([["Bob", "Alice", "Charlie"]])
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Bob should win in 1 round
        assert db_winner == py_winner == "Bob"
        assert db_rounds == py_rounds == 1
        
    def test_incomplete_ballots(self, test_db):
        """Test handling of ballots that don't rank all candidates."""
        poll_id = test_db.create_poll("Incomplete Ballots Test", ["Alice", "Bob", "Charlie", "Dave"])
        
        # Mix of complete and incomplete ballots
        ballots = [
            ["Alice", "Bob"],                      # Incomplete ballot
            ["Bob", "Charlie", "Dave"],            # Incomplete ballot  
            ["Charlie", "Dave", "Alice", "Bob"],   # Complete ballot
            ["Dave"],                              # Very incomplete ballot
            ["Alice", "Bob", "Charlie", "Dave"]    # Complete ballot
        ]
        
        for ballot in ballots:
            test_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Results should match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
    def test_complex_redistribution(self, test_db):
        """Test complex vote redistribution scenario."""
        poll_id = test_db.create_poll("Complex Redistribution", ["Alice", "Bob", "Charlie", "Dave", "Eve"])
        
        # Complex scenario with multiple elimination rounds
        ballots = [
            # Alice supporters (will mostly go to Bob when Alice eliminated)
            ["Alice", "Bob", "Charlie", "Dave", "Eve"],
            ["Alice", "Bob", "Dave", "Charlie", "Eve"],
            
            # Bob direct supporters  
            ["Bob", "Charlie", "Alice", "Dave", "Eve"],
            ["Bob", "Alice", "Charlie", "Dave", "Eve"],
            ["Bob", "Charlie", "Dave", "Alice", "Eve"],
            
            # Charlie supporters (mixed second preferences)
            ["Charlie", "Bob", "Alice", "Dave", "Eve"],
            ["Charlie", "Dave", "Bob", "Alice", "Eve"],
            
            # Dave supporters (will go to different candidates)
            ["Dave", "Eve", "Charlie", "Bob", "Alice"],
            
            # Eve supporters (fewest, eliminated first)
            ["Eve", "Dave", "Charlie", "Bob", "Alice"]
        ]
        
        for ballot in ballots:
            test_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = test_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
        # Verify each round's vote redistribution
        db_rounds_data = test_db.get_round_data(poll_id)
        rounds_by_num = defaultdict(list)
        for row in db_rounds_data:
            rounds_by_num[row['round_number']].append(row)
            
        for round_num, py_round in enumerate(rounds_data, 1):
            db_round = rounds_by_num[round_num]
            db_counts = {row['option_name']: row['vote_count'] for row in db_round}
            
            # Vote counts should match exactly
            assert db_counts == py_round['counts'], f"Round {round_num} counts don't match"


if __name__ == "__main__":
    """Run tests directly with python test_ranked_choice_voting.py"""
    pytest.main([__file__, "-v"])