// JavaScript implementation of the ranked choice elimination algorithm
// This matches the SQL function logic to calculate expected test results

export function calculateRankedChoiceWinner(candidates, votes) {
  const results = {
    winner: null,
    rounds: [],
    totalRounds: 0
  }
  
  let currentRound = 1
  let eliminatedOptions = new Set()
  const totalCandidates = candidates.length
  
  // Main elimination loop
  while (true) {
    // Get active candidates (not eliminated)
    const activeCandidates = candidates.filter(c => !eliminatedOptions.has(c))
    
    // Count first-choice votes for active candidates
    const voteCounts = {}
    activeCandidates.forEach(candidate => {
      voteCounts[candidate] = 0
    })
    
    // Count votes - for each ballot, find highest-ranked non-eliminated candidate
    let activeVotesThisRound = 0
    votes.forEach(ballot => {
      for (const candidate of ballot) {
        if (activeCandidates.includes(candidate)) {
          voteCounts[candidate]++
          activeVotesThisRound++
          break // Found highest preference, stop looking at this ballot
        }
      }
      // Note: if no active candidates found, ballot is exhausted (doesn't increment activeVotesThisRound)
    })
    
    // Calculate majority threshold based on active votes this round
    const majorityThreshold = Math.floor(activeVotesThisRound / 2) + 1
    
    // Find candidate with most votes
    let maxVotes = 0
    let winningCandidate = null
    
    // Sort candidates by vote count DESC, then alphabetically ASC for consistent tie-breaking
    const sortedCandidates = activeCandidates
      .sort((a, b) => {
        if (voteCounts[b] !== voteCounts[a]) {
          return voteCounts[b] - voteCounts[a] // Descending by votes
        }
        return a.localeCompare(b) // Ascending alphabetically
      })
    
    if (sortedCandidates.length > 0) {
      winningCandidate = sortedCandidates[0]
      maxVotes = voteCounts[winningCandidate]
    }
    
    // Store round results
    const roundResults = activeCandidates.map(candidate => ({
      candidate,
      votes: voteCounts[candidate],
      eliminated: false
    }))
    
    // Check for winner (majority or only one candidate left)
    if (maxVotes >= majorityThreshold || activeCandidates.length <= 1) {
      results.winner = winningCandidate
      results.rounds.push({
        round: currentRound,
        results: roundResults
      })
      break
    }
    
    // Find minimum vote count for elimination
    const minVotes = Math.min(...activeCandidates.map(c => voteCounts[c]))
    
    // Get all candidates tied for last place (minimum votes)
    const tiedCandidates = activeCandidates.filter(c => voteCounts[c] === minVotes)
    
    let candidateToEliminate
    
    if (tiedCandidates.length === 1) {
      // Only one candidate has minimum votes
      candidateToEliminate = tiedCandidates[0]
    } else {
      // Multiple candidates tied - use Borda count tie-breaking
      const bordaScores = {}
      
      // Calculate Borda scores for tied candidates only
      tiedCandidates.forEach(candidate => {
        bordaScores[candidate] = 0
      })
      
      votes.forEach(ballot => {
        // Calculate offset for excluded candidates
        const excludedCount = totalCandidates - ballot.length
        
        ballot.forEach((candidate, index) => {
          if (tiedCandidates.includes(candidate)) {
            // Borda points = candidates below this one + excluded candidates
            // Position in ballot gives us candidates below (ballot.length - index - 1)
            // Plus all excluded candidates get ranked below the ranked ones
            const bordaPoints = (ballot.length - index - 1) + excludedCount
            bordaScores[candidate] += bordaPoints
          }
        })
      })
      
      // Find minimum Borda score
      const minBordaScore = Math.min(...tiedCandidates.map(c => bordaScores[c]))
      const lowestBordaCandidates = tiedCandidates.filter(c => bordaScores[c] === minBordaScore)
      
      if (lowestBordaCandidates.length === 1) {
        candidateToEliminate = lowestBordaCandidates[0]
      } else {
        // Still tied after Borda - eliminate alphabetically LAST (DESC order)
        candidateToEliminate = lowestBordaCandidates.sort((a, b) => b.localeCompare(a))[0]
      }
    }
    
    // Mark candidate as eliminated
    eliminatedOptions.add(candidateToEliminate)
    roundResults.find(r => r.candidate === candidateToEliminate).eliminated = true
    
    results.rounds.push({
      round: currentRound,
      results: roundResults
    })
    
    currentRound++
    
    // Safety check
    if (currentRound > 50) {
      throw new Error('Too many rounds - possible infinite loop')
    }
  }
  
  results.totalRounds = currentRound
  return results
}

// Helper function to format results for test expectations
export function formatForTestExpectation(results) {
  const formatted = {}
  
  results.rounds.forEach(round => {
    formatted[round.round] = {
      round: round.round,
      results: round.results.map(r => [r.candidate, r.votes, r.eliminated])
    }
  })
  
  return {
    winner: results.winner,
    rounds: Object.values(formatted)
  }
}

// Test the three failing scenarios + borda-tiebreak-fix scenarios
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Testing Elimination Algorithm ===\n')
  
  // Borda-tiebreak-fix Test 1
  console.log('BORDA-TIEBREAK-FIX TEST 1: A and C tied for lowest Borda, B higher')
  const bordaTest1 = calculateRankedChoiceWinner(['A', 'B', 'C'], [
    ['A', 'B', 'C'],  // A=3pts, B=2pts, C=1pt
    ['C', 'B', 'A'],  // C=3pts, B=2pts, A=1pt  
    ['B', 'C', 'A']   // B=3pts, C=2pts, A=1pt
  ])
  console.log('Winner:', bordaTest1.winner)
  const bordaFormatted1 = formatForTestExpectation(bordaTest1)
  console.log('Rounds:', JSON.stringify(bordaFormatted1.rounds, null, 2))
  
  // Borda-tiebreak-fix Test 2
  console.log('\nBORDA-TIEBREAK-FIX TEST 2: multiple candidates tied for lowest Borda score')
  const bordaTest2 = calculateRankedChoiceWinner(['A', 'B', 'C', 'D'], [
    ['A', 'B', 'C', 'D'],  // A=4, B=3, C=2, D=1
    ['D', 'C', 'B', 'A'],  // D=4, C=3, B=2, A=1
    ['B', 'A', 'D', 'C'],  // B=4, A=3, D=2, C=1  
    ['C', 'D', 'A', 'B']   // C=4, D=3, A=2, B=1
  ])
  console.log('Winner:', bordaTest2.winner)
  const bordaFormatted2 = formatForTestExpectation(bordaTest2)
  console.log('Rounds:', JSON.stringify(bordaFormatted2.rounds, null, 2))
  
  // Borda-tiebreak-fix Test 3
  console.log('\nBORDA-TIEBREAK-FIX TEST 3: only consider lowest Borda score candidates')
  const bordaTest3 = calculateRankedChoiceWinner(['A', 'B', 'C', 'D'], [
    ['A', 'B', 'D', 'C'],  // A=4, B=3, D=2, C=1
    ['B', 'A', 'D', 'C'],  // B=4, A=3, D=2, C=1
    ['C', 'D', 'A', 'B'],  // C=4, D=3, A=2, B=1
    ['D', 'C', 'A', 'B']   // D=4, C=3, A=2, B=1
  ])
  console.log('Winner:', bordaTest3.winner)
  const bordaFormatted3 = formatForTestExpectation(bordaTest3)
  console.log('Rounds:', JSON.stringify(bordaFormatted3.rounds, null, 2))
}