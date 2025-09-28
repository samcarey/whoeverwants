# Auto-Testing Agent Specification

## Purpose
An autonomous agent that runs after every completed task to verify the implementation works correctly using Playwright tests.

## Agent Capabilities
- Automatically triggered after task completion
- Analyzes the type of change made
- Generates appropriate Playwright tests
- Executes tests and reports results
- Provides debugging information on failures

## Test Categories

### 1. UI Component Changes
- **Triggers**: Changes to React components, CSS, UI elements
- **Tests**:
  - Component renders without errors
  - Interactive elements work (buttons, forms, inputs)
  - Visual regression (screenshots)
  - Accessibility compliance

### 2. Form/Input Changes
- **Triggers**: Changes to forms, input validation, submission logic
- **Tests**:
  - Form validation works correctly
  - Success/error states display properly
  - Data submission flows
  - Edge cases (empty inputs, invalid data)

### 3. API/Database Changes
- **Triggers**: Changes to API routes, database queries, data models
- **Tests**:
  - API endpoints return expected responses
  - Database operations complete successfully
  - Error handling works correctly
  - Data integrity maintained

### 4. Navigation/Routing Changes
- **Triggers**: Changes to page routing, navigation, URL handling
- **Tests**:
  - Pages load correctly
  - Navigation links work
  - URL parameters handled properly
  - 404 handling

### 5. Feature Integration Tests
- **Triggers**: Multi-component changes, workflow modifications
- **Tests**:
  - End-to-end user workflows
  - Integration between components
  - State management across components

## Test Execution Flow

1. **Analysis Phase**
   - Examine changed files
   - Determine test category
   - Identify key functionality to test

2. **Test Generation Phase**
   - Generate Playwright test script
   - Include positive and negative test cases
   - Add error condition testing

3. **Execution Phase**
   - Run tests in headless browser
   - Capture screenshots on failure
   - Log detailed error information

4. **Reporting Phase**
   - Provide pass/fail status
   - Include error details and debugging info
   - Suggest fixes for failed tests

## Agent Invocation

The agent should be called with:
- **Task description**: What was implemented
- **Changed files**: List of modified files
- **Expected behavior**: What the change should accomplish
- **Test context**: Relevant URLs, data, or setup needed

## Output Format

```
🧪 AUTO-TEST RESULTS for: [Task Description]

✅ PASSED: [Test Name] - [Brief Description]
❌ FAILED: [Test Name] - [Error Description]
⚠️  WARNING: [Test Name] - [Issue Description]

🔍 DEBUGGING INFO:
- Screenshots: [paths]
- Console errors: [errors]
- Network issues: [details]
- Performance metrics: [timing]

📋 RECOMMENDATIONS:
- [Specific fix suggestions]
- [Areas needing attention]
```

## Integration Points

- Triggered automatically when TodoWrite marks tasks as completed
- Accesses local development server (http://localhost:3000)
- Uses project's existing test data and setup
- Integrates with existing database and API endpoints