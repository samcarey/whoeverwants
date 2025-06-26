# Ranked Choice Voting Test Suite

This test suite provides comprehensive testing of the ranked choice voting system by comparing database results with local Python calculations.

## Overview

The test suite:
1. Creates a temporary PostgreSQL database for each test session
2. Runs all database migrations to set up the schema
3. Creates polls and submits various ballot combinations
4. Calculates results using both the database function and a Python implementation
5. Compares results to ensure they match exactly

## Prerequisites

- PostgreSQL server running locally
- Python 3.8+
- pip for installing dependencies

## Setup

1. Install test dependencies:
```bash
cd tests
pip install -r requirements.txt
```

2. Ensure PostgreSQL is running and accessible:
```bash
# Test connection (replace with your credentials)
psql -h localhost -U postgres -c "SELECT 1"
```

## Running Tests

### Basic Usage
```bash
# Run all tests
python -m pytest test_ranked_choice_voting.py -v

# Run specific test
python -m pytest test_ranked_choice_voting.py::TestRankedChoiceVoting::test_simple_majority_winner -v

# Run with custom database credentials
python -m pytest test_ranked_choice_voting.py -v --postgres-user=myuser --postgres-password=mypass
```

### Direct Python Execution
```bash
# Run tests directly
python test_ranked_choice_voting.py
```

## Test Cases

The test suite includes the following scenarios:

### 1. Simple Majority Winner (`test_simple_majority_winner`)
- Tests cases where one candidate has a clear majority in the first round
- Verifies no elimination rounds are needed

### 2. Multiple Elimination Rounds (`test_elimination_rounds`) 
- Tests scenarios requiring multiple rounds of elimination
- Verifies vote redistribution works correctly
- Compares round-by-round results between database and Python

### 3. Tie Elimination (`test_tie_elimination`)
- Tests handling of ties in elimination (multiple candidates with same lowest vote count)
- Verifies all tied candidates are eliminated simultaneously

### 4. Edge Cases
- **No Votes** (`test_no_votes`): Poll with no ballots submitted
- **Single Vote** (`test_single_vote`): Poll with only one ballot
- **Incomplete Ballots** (`test_incomplete_ballots`): Ballots that don't rank all candidates

### 5. Complex Redistribution (`test_complex_redistribution`)
- Tests complex scenarios with 5 candidates and intricate vote redistribution
- Verifies the algorithm handles multiple elimination rounds correctly
- Tests that vote transfers follow the correct preference order

## Algorithm Implementation

### Database Algorithm
The database uses a PostgreSQL function `calculate_ranked_choice_winner()` that implements Instant Runoff Voting (IRV):

- **Majority Threshold**: More than half of total ballots
- **Elimination Strategy**: Remove all candidates with minimum vote count (handles ties)
- **Vote Redistribution**: Uses highest-ranked non-eliminated candidate from each ballot
- **Round Tracking**: Stores detailed results in `ranked_choice_rounds` table

### Python Algorithm  
The Python implementation (`RankedChoiceCalculator`) mirrors the database logic exactly:

- Same majority threshold calculation
- Same tie-handling in elimination
- Same vote counting and redistribution logic
- Detailed round tracking for comparison

## Test Database Management

Each test run:
1. Creates a unique temporary database (e.g., `test_whoeverwants_a1b2c3d4`)
2. Runs all migrations to set up the schema
3. Performs tests with the isolated database
4. Cleans up by dropping the temporary database

This ensures:
- No interference between test runs
- Clean state for each test
- No pollution of development/production data

## Troubleshooting

### Connection Issues
```bash
# Check PostgreSQL is running
brew services list | grep postgres  # macOS
systemctl status postgresql         # Linux

# Test connection manually
psql -h localhost -U postgres -c "SELECT version()"
```

### Permission Issues
```bash
# Grant database creation permissions
psql -h localhost -U postgres -c "ALTER USER postgres CREATEDB"
```

### Migration Issues
If migrations fail, check:
- All migration files are present in `database/migrations/`
- Migration files follow the naming convention: `###_description_up.sql`
- SQL syntax is valid PostgreSQL

## Adding New Tests

To add new test cases:

1. Add a new method to `TestRankedChoiceVoting` class
2. Follow the pattern:
   ```python
   def test_your_scenario(self, test_db):
       # Create poll
       poll_id = test_db.create_poll("Test Name", ["A", "B", "C"])
       
       # Submit ballots
       ballots = [["A", "B", "C"], ["B", "A", "C"]] 
       for ballot in ballots:
           test_db.submit_ballot(poll_id, ballot)
           
       # Calculate with both methods
       db_winner, db_rounds = test_db.calculate_winner(poll_id) 
       calculator = RankedChoiceCalculator(ballots)
       py_winner, py_rounds, rounds_data = calculator.calculate_winner()
       
       # Verify results match
       assert db_winner == py_winner
       assert db_rounds == py_rounds
   ```

3. Run the new test to ensure it passes:
   ```bash
   python -m pytest test_ranked_choice_voting.py::TestRankedChoiceVoting::test_your_scenario -v
   ```