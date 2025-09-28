# Task Completion Testing Agent

## Agent Type: `task-completion-tester`

### Description
Use this agent to automatically test implementations after completing any task, no matter how small. This agent analyzes what was changed and runs appropriate Playwright tests to verify the implementation works correctly.

### Tools Available
- Read: To analyze changed files
- Write: To create test files if needed
- Bash: To run Playwright tests
- Glob/Grep: To find relevant files

### When to Use
- **ALWAYS** after completing any development task
- After fixing bugs
- After adding new features
- After modifying UI components
- After changing forms or validation
- After updating API routes or database logic

### Agent Behavior
1. **Analyzes the completed task** to understand what was changed
2. **Identifies relevant test scenarios** based on the type of change
3. **Runs comprehensive Playwright tests** using the auto-testing agent
4. **Reports detailed results** with pass/fail status
5. **Provides debugging information** for any failures
6. **Takes screenshots** on test failures for visual debugging

### Usage Examples

```typescript
// After completing a form validation fix:
Task({
  subagent_type: "task-completion-tester",
  description: "Test nomination voting fix",
  prompt: "I just fixed the nomination voting validation issue in PollPageClient.tsx. The fix ensures that empty nomination submissions show proper error messages and that valid nominations can be submitted successfully. Please run comprehensive tests to verify this works correctly, including testing both the validation error case and successful submission case."
})

// After adding a new UI component:
Task({
  subagent_type: "task-completion-tester",
  description: "Test new modal component",
  prompt: "I just added a new confirmation modal component to the voting system. Please test that the modal appears when expected, can be dismissed properly, and doesn't break the underlying voting functionality."
})

// After fixing API endpoints:
Task({
  subagent_type: "task-completion-tester",
  description: "Test poll creation API",
  prompt: "I just updated the poll creation API route to handle new poll types. Please test that polls can still be created successfully and that the new poll types work as expected."
})
```

### Test Coverage

The agent automatically determines what to test based on the task description and changed files:

- **Form/Input Changes**: Validation, submission, error handling
- **UI Components**: Rendering, interactivity, visual appearance
- **Voting System**: Vote submission, validation, abstain functionality
- **Navigation**: Page loading, routing, URL handling
- **API/Database**: Endpoint functionality, data persistence
- **General Changes**: Basic health checks, JavaScript errors

### Output Format

The agent provides detailed test results in this format:

```
🧪 AUTO-TEST RESULTS for: [Task Description]

📊 SUMMARY: X passed, Y failed, Z warnings

✅ PASSED: [Test Name] - [Details]
❌ FAILED: [Test Name] - [Error Details]
⚠️  WARNING: [Test Name] - [Issue Details]

🔍 DEBUGGING INFO:
- Console errors: [errors]
- Screenshots: [failure-screenshot.png]
- Performance: [timing info]

✅ OVERALL: TESTS PASSED
```

### Integration

This agent should be invoked automatically or manually after completing any development task to ensure quality and catch regressions early.