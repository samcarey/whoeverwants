# 5-Round Ranked Choice Voting Demo

This demonstrates a carefully crafted scenario that requires exactly 5 elimination rounds to determine a winner.

## Poll Information
- **Title**: 5-Round Demo: Best Programming Language
- **Candidates**: Alice, Bob, Charlie, Dave, Eve, Frank
- **Total Ballots**: 15
- **Poll ID**: `0af70281-1745-4c02-8e09-093956d632f3`

## 📊 The Ballots (Left Side)

Here are the 15 carefully designed ballots that create the 5-round elimination:

### Alice Supporters (4 ballots)
```
Ballot 1:  Alice → Bob → Charlie → Dave → Eve → Frank
Ballot 2:  Alice → Bob → Charlie → Dave → Eve → Frank  
Ballot 3:  Alice → Bob → Charlie → Dave → Eve → Frank
Ballot 4:  Alice → Charlie → Dave → Eve → Frank → Bob
```

### Bob Supporters (3 ballots)
```
Ballot 5:  Bob → Alice → Charlie → Dave → Eve → Frank
Ballot 6:  Bob → Alice → Charlie → Dave → Eve → Frank
Ballot 7:  Bob → Charlie → Alice → Dave → Eve → Frank
```

### Charlie Supporters (3 ballots)
```
Ballot 8:  Charlie → Dave → Alice → Bob → Eve → Frank
Ballot 9:  Charlie → Alice → Bob → Dave → Eve → Frank
Ballot 10: Charlie → Bob → Alice → Dave → Eve → Frank
```

### Dave Supporters (2 ballots)
```
Ballot 11: Dave → Eve → Charlie → Alice → Bob → Frank
Ballot 12: Dave → Charlie → Eve → Alice → Bob → Frank
```

### Eve Supporters (2 ballots)
```
Ballot 13: Eve → Frank → Dave → Charlie → Alice → Bob
Ballot 14: Eve → Dave → Frank → Charlie → Bob → Alice
```

### Frank Supporter (1 ballot)
```
Ballot 15: Frank → Eve → Dave → Charlie → Bob → Alice
```

## 🏆 The Results (Right Side)

**Winner**: Charlie (after 5 rounds)  
**Total Votes**: 15  

### Round-by-Round Elimination Process

#### Round 1: Frank Eliminated
```
Alice:   4 votes (26.7%)
Charlie: 3 votes (20.0%)
Bob:     3 votes (20.0%)
Eve:     2 votes (13.3%)
Dave:    2 votes (13.3%)
Frank:   1 vote  (6.7%)  ❌ ELIMINATED
```
**Frank is eliminated** with only 1 vote. His supporter's vote transfers to their #2 choice (Eve).

#### Round 2: Dave Eliminated  
```
Alice:   4 votes (26.7%)
Charlie: 3 votes (20.0%)
Bob:     3 votes (20.0%) 
Eve:     3 votes (20.0%)  ← Frank's vote transferred here
Dave:    2 votes (13.3%)  ❌ ELIMINATED
```
**Dave is eliminated** with fewest votes. His supporters' votes transfer to their next choices.

#### Round 3: Bob Eliminated
```
Charlie: 4 votes (26.7%)  ← Dave supporters transferred here
Eve:     4 votes (26.7%)  ← Dave supporters transferred here  
Alice:   4 votes (26.7%)
Bob:     3 votes (20.0%)  ❌ ELIMINATED
```
**Bob is eliminated** despite having 3 strong supporters. His votes transfer to their #2 choices.

#### Round 4: Eve Eliminated
```
Alice:   6 votes (40.0%)  ← Bob supporters transferred here
Charlie: 5 votes (33.3%)  ← Bob supporters transferred here
Eve:     4 votes (26.7%)  ❌ ELIMINATED
```
**Eve is eliminated**. Her supporters' votes transfer to their remaining choices.

#### Round 5: Final Round - Charlie Wins!
```
Charlie: 9 votes (60.0%)  👑 WINNER
Alice:   6 votes (40.0%)
```
**Charlie achieves majority** with 60% of votes and wins!

## 🔄 Vote Transfer Analysis

This demonstrates the beauty of ranked choice voting:

1. **Frank supporters** (1 voter) → went to Eve
2. **Dave supporters** (2 voters) → split between Charlie and Eve  
3. **Bob supporters** (3 voters) → split between Alice and Charlie
4. **Eve supporters** (4 voters total after transfers) → went to Charlie

Charlie's victory shows how a candidate can win through coalition building - starting with only 3 first-choice votes but gaining support as other candidates are eliminated based on voters' backup preferences.

## 📱 Live Demo URLs

- **Poll**: http://localhost:3000/poll?id=0af70281-1745-4c02-8e09-093956d632f3
- **Results**: http://localhost:3000/results?id=0af70281-1745-4c02-8e09-093956d632f3

## 🎯 Key Insights

1. **Coalition Building**: Charlie won by being the second choice of many voters
2. **No Wasted Votes**: Every ballot contributed to the final outcome through transfers
3. **Majority Rule**: Winner achieved 60% support in final round (9 of 15 votes)
4. **Algorithm Efficiency**: Complex elimination scenario resolved in exactly 5 rounds
5. **Fair Representation**: Final result reflects the collective preferences of all voters

This demonstrates how ranked choice voting can produce consensus winners who have broad support across the electorate, even when no candidate initially has a majority of first-choice votes.