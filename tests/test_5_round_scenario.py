#!/usr/bin/env python3
"""
Test the designed 5-round scenario to verify it works as expected.
"""

from test_ranked_choice_voting import RankedChoiceCalculator

def test_5_round_scenario():
    """Test the carefully designed 5-round elimination scenario."""
    
    # Designed ballots for 5-round elimination
    ballots = [
        # Alice supporters (4 total) - should win in final round
        ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    # 1
        ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    # 2
        ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    # 3
        ["Alice", "Charlie", "Dave", "Eve", "Frank", "Bob"],    # 4
        
        # Bob supporters (3 total) - should be runner-up
        ["Bob", "Alice", "Charlie", "Dave", "Eve", "Frank"],    # 5
        ["Bob", "Alice", "Charlie", "Dave", "Eve", "Frank"],    # 6
        ["Bob", "Charlie", "Alice", "Dave", "Eve", "Frank"],    # 7
        
        # Charlie supporters (3 total) - eliminated round 4
        ["Charlie", "Dave", "Alice", "Bob", "Eve", "Frank"],    # 8
        ["Charlie", "Alice", "Bob", "Dave", "Eve", "Frank"],    # 9
        ["Charlie", "Bob", "Alice", "Dave", "Eve", "Frank"],    # 10
        
        # Dave supporters (2 total) - eliminated round 3
        ["Dave", "Eve", "Charlie", "Alice", "Bob", "Frank"],    # 11
        ["Dave", "Charlie", "Eve", "Alice", "Bob", "Frank"],    # 12
        
        # Eve supporters (2 total) - eliminated round 2
        ["Eve", "Frank", "Dave", "Charlie", "Alice", "Bob"],    # 13
        ["Eve", "Dave", "Frank", "Charlie", "Bob", "Alice"],    # 14
        
        # Frank supporter (1 total) - eliminated round 1
        ["Frank", "Eve", "Dave", "Charlie", "Bob", "Alice"]     # 15
    ]
    
    print("🗳️  Testing 5-Round Elimination Scenario")
    print("=" * 50)
    
    # Calculate winner
    calculator = RankedChoiceCalculator(ballots)
    winner, total_rounds, rounds_data = calculator.calculate_winner()
    
    print(f"Winner: {winner}")
    print(f"Total Rounds: {total_rounds}")
    print()
    
    # Show detailed round-by-round breakdown
    for i, round_data in enumerate(rounds_data, 1):
        print(f"Round {i}:")
        # Sort by vote count descending
        sorted_counts = sorted(round_data['counts'].items(), key=lambda x: x[1], reverse=True)
        for candidate, votes in sorted_counts:
            eliminated_marker = " (ELIMINATED)" if candidate in round_data['eliminated'] else ""
            print(f"  {candidate}: {votes} votes{eliminated_marker}")
        if round_data['eliminated']:
            print(f"  → Eliminated: {', '.join(round_data['eliminated'])}")
        print()
    
    return winner, total_rounds, rounds_data

if __name__ == "__main__":
    test_5_round_scenario()