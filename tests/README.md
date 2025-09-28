# Ranking Algorithm Test Suite

Comprehensive, maintainable test suite for all poll ranking algorithms with fluent, readable test syntax.

## 🎯 Goals

- **Confidence**: Catch regressions in ranking logic before they reach production
- **Maintainability**: Easy to add new tests as algorithms evolve
- **Readability**: Tests clearly show inputs, expected outputs, and step-by-step validation
- **CI Integration**: Automated testing before merge prevents bugs

## 📁 Structure

```
tests/
├── __tests__/
│   └── ranked-choice/
│       ├── basic-scenarios.test.js     # Core RCV functionality
│       ├── zero-vote-elimination.test.js # Bug fix validation
│       ├── tie-breaking.test.js        # Tie resolution scenarios
│       └── edge-cases.test.js          # Boundary conditions
├── helpers/
│   ├── database.js                     # Test database management
│   └── poll-builder.js                 # Fluent test API
├── fixtures/                           # Test data
├── setup.js                           # Test environment setup
└── run-specific-tests.js              # Targeted test runner
```

## 🚀 Quick Start

### Run All Tests
```bash
npm test                    # Watch mode for development
npm run test:run           # Run once and exit
npm run test:coverage      # With coverage report
```

### Run Specific Test Suites
```bash
npm run test:algorithms       # All ranking algorithm tests
npm run test:zero-vote-bug   # Just the bug fix validation
npm run test:tie-breaking    # Tie resolution scenarios
npm run test:edge-cases      # Edge cases and boundaries
npm run test:basic           # Basic RCV functionality
```

### Interactive Testing
```bash
npm run test:ui             # Open Vitest UI in browser
npm run test:watch          # Watch mode with file monitoring
```

## 📝 Writing Tests

### Fluent API Example

The test API is designed for maximum readability:

```javascript
await createPoll(['A', 'B', 'C', 'D'])
  .withVotes([
    ['A', 'D', 'B', 'C'],  // Voter 1: A first, D second, etc.
    ['B', 'A', 'C', 'D'],  // Voter 2: B first, A second, etc.
    ['C', 'B', 'A', 'D']   // Voter 3: C first, B second, etc.
  ])
  .expectRounds([
    { round: 1, results: [
      ['A', 1, false],  // A: 1 vote, not eliminated
      ['B', 1, false],  // B: 1 vote, not eliminated  
      ['C', 1, false],  // C: 1 vote, not eliminated
      ['D', 0, true]    // D: 0 votes, eliminated
    ]},
    { round: 2, results: [
      ['A', 2, false],  // A: gets D's transfers
      ['B', 1, true],   // B: eliminated in tie
      ['C', 1, true]    // C: eliminated in tie
    ]}
  ])
  .expectWinner('A')
  .run()
```

### Key Features

- **Automatic Cleanup**: Tests clean up after themselves
- **Clear Assertions**: Vote counts and eliminations explicitly checked
- **Readable Format**: `[candidate, votes, eliminated]` tuples
- **Step-by-Step**: Round-by-round validation ensures algorithm correctness

### Adding New Tests

1. Create test in appropriate file under `tests/__tests__/ranked-choice/`
2. Use fluent API for clarity
3. Test both expected behavior and edge cases  
4. Add to `run-specific-tests.js` if creating new category

## 🔄 CI Integration

### Pre-Merge Validation

Tests automatically run on:
- Push to `main` or `develop` branches
- Pull request creation/updates
- Before merge (required for branch protection)

### Quality Gates

- ✅ All tests must pass
- ✅ Coverage must meet 80% threshold  
- ✅ No linting errors
- ✅ Ranking algorithm regression tests pass

### Branch Protection Setup

To require tests before merge, configure branch protection:

1. Go to repository Settings → Branches
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select "Test Suite" and "Pull Request Checks" workflows
5. Enable "Require up to date branches before merging"

## 🧪 Test Categories

### Basic Scenarios (`basic-scenarios.test.js`)
- Immediate majority winners
- Sequential elimination  
- Vote redistribution logic
- Standard RCV behavior

### Zero Vote Elimination (`zero-vote-elimination.test.js`)  
- **Critical**: Validates fix for production bug
- Candidates with 0 first-place votes eliminated first
- Multiple zero-vote scenarios
- Edge cases with partial rankings

### Tie Breaking (`tie-breaking.test.js`)
- Last place ties (current: eliminate all tied)
- Perfect ties across all rounds
- Vote redistribution after elimination
- Complex multi-candidate ties

### Edge Cases (`edge-cases.test.js`)
- Empty ballots and minimal votes
- Incomplete/partial ballots  
- Large numbers of candidates
- Unusual voting patterns
- Boundary conditions (50-50 splits, etc.)

## 📊 Coverage Requirements

- **Functions**: 80%+ coverage of algorithm functions
- **Branches**: All elimination paths tested
- **Edge Cases**: Boundary conditions covered  
- **Regression**: All known bugs have tests

## 🛠 Debugging Failed Tests

### View Test Results
```bash
npm run test:ui            # Visual test results
npm run test:coverage      # See what's not covered
```

### Run Specific Bug Tests
```bash
npm run test:zero-vote-bug    # Check if bug is still fixed
npm run test:tie-breaking     # Validate tie logic
```

### Database Issues
```bash
node apply_fix_migration.js  # Ensure test DB has latest schema
```

## 📈 Future Additions

When adding new poll types or algorithm changes:

1. **Add test file** in appropriate category
2. **Update fluent API** if new patterns needed
3. **Extend CI workflows** for new validation requirements  
4. **Document edge cases** in test comments
5. **Update coverage thresholds** as codebase grows

## 🎖 Best Practices

- ✅ **Descriptive test names**: Clear what scenario is being tested
- ✅ **Explicit expectations**: Don't rely on implementation details
- ✅ **Independent tests**: Each test can run in isolation
- ✅ **Readable data**: Vote patterns should be obvious
- ✅ **Comprehensive coverage**: Test success paths AND edge cases
- ❌ **Avoid implementation details**: Test behavior, not internal logic
- ❌ **Don't over-test**: Focus on algorithm correctness, not framework features