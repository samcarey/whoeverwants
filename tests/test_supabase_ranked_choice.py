#!/usr/bin/env python3
"""
Test suite for ranked choice voting against Supabase test database.
This verifies that the algorithm works correctly in the cloud environment.
"""

import os
import pytest
import psycopg2
from psycopg2.extras import RealDictCursor
import uuid
from typing import List, Dict, Tuple, Optional
from collections import defaultdict, Counter
import json

# Use the same RankedChoiceCalculator from the main test file
from test_ranked_choice_voting import RankedChoiceCalculator


class SupabaseTestDatabase:
    """Test against Supabase test database."""
    
    def __init__(self):
        # Use test database credentials from .env.local
        self.supabase_url = "https://kfngceqepnzlljkwedtd.supabase.co"
        # Try different connection string formats for Supabase
        # Option 1: Session mode (port 5432, supports IPv4/IPv6)
        self.connection_string = "postgresql://postgres.kfngceqepnzlljkwedtd:U0oYNzYdyEgpSbgz@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
        # Option 2: Transaction mode (port 6543, for serverless)
        # self.connection_string = "postgresql://postgres.kfngceqepnzlljkwedtd:U0oYNzYdyEgpSbgz@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
        self.conn = None
        
    def setup(self):
        """Connect to Supabase test database."""
        self.conn = psycopg2.connect(
            self.connection_string,
            cursor_factory=RealDictCursor
        )
        
    def teardown(self):
        """Clean up test data."""
        if self.conn:
            # Clean up any test data we created
            with self.conn.cursor() as cur:
                # Delete test poll data (cascade will handle related records)
                cur.execute("DELETE FROM polls WHERE title LIKE 'Test_%'")
            self.conn.commit()
            self.conn.close()
        
    def create_poll(self, title: str, options: List[str]) -> str:
        """Create a ranked choice poll and return its ID."""
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
def supabase_db():
    """Pytest fixture for Supabase test database."""
    db = SupabaseTestDatabase()
    db.setup()
    yield db
    db.teardown()


class TestSupabaseRankedChoiceVoting:
    """Test suite for ranked choice voting against Supabase."""
    
    def test_simple_majority_winner_supabase(self, supabase_db):
        """Test case where one candidate has clear majority in first round."""
        poll_id = supabase_db.create_poll("Test_Simple_Majority", ["Alice", "Bob", "Charlie"])
        
        # Submit ballots: Alice gets majority
        ballots = [
            ["Alice", "Bob", "Charlie"],  # Alice voters
            ["Alice", "Charlie", "Bob"],
            ["Alice", "Bob", "Charlie"],
            ["Bob", "Alice", "Charlie"],  # Bob voter
            ["Charlie", "Bob", "Alice"]   # Charlie voter
        ]
        
        for ballot in ballots:
            supabase_db.submit_ballot(poll_id, ballot)
            
        # Calculate with database
        db_winner, db_rounds = supabase_db.calculate_winner(poll_id)
        
        # Calculate with Python
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner == "Alice"
        assert db_rounds == py_rounds == 1
        
    def test_elimination_rounds_supabase(self, supabase_db):
        """Test case requiring multiple elimination rounds."""
        poll_id = supabase_db.create_poll("Test_Elimination_Rounds", ["Alice", "Bob", "Charlie", "Dave"])
        
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
            supabase_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = supabase_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
        # Verify round progression
        db_rounds_data = supabase_db.get_round_data(poll_id)
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
            
    def test_complex_redistribution_supabase(self, supabase_db):
        """Test complex vote redistribution scenario."""
        poll_id = supabase_db.create_poll("Test_Complex_Redistribution", ["Alice", "Bob", "Charlie", "Dave", "Eve"])
        
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
            supabase_db.submit_ballot(poll_id, ballot)
            
        # Calculate with both methods
        db_winner, db_rounds = supabase_db.calculate_winner(poll_id)
        calculator = RankedChoiceCalculator(ballots)
        py_winner, py_rounds, rounds_data = calculator.calculate_winner()
        
        # Verify results match
        assert db_winner == py_winner
        assert db_rounds == py_rounds
        
        # Verify each round's vote redistribution
        db_rounds_data = supabase_db.get_round_data(poll_id)
        rounds_by_num = defaultdict(list)
        for row in db_rounds_data:
            rounds_by_num[row['round_number']].append(row)
            
        for round_num, py_round in enumerate(rounds_data, 1):
            db_round = rounds_by_num[round_num]
            db_counts = {row['option_name']: row['vote_count'] for row in db_round}
            
            # Vote counts should match exactly
            assert db_counts == py_round['counts'], f"Round {round_num} counts don't match"


if __name__ == "__main__":
    """Run Supabase tests directly with python test_supabase_ranked_choice.py"""
    pytest.main([__file__, "-v"])