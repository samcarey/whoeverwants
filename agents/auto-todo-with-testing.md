# Auto-Testing TodoWrite Integration

## Concept: Enhanced TodoWrite Workflow

Create a systematic approach where completing any development task automatically triggers testing.

## Implementation Strategy

### **Method 1: Behavioral Rule**
Claude follows a consistent pattern:

1. Complete task using TodoWrite
2. Immediately invoke auto-testing agent via Task tool
3. Report results to user
4. Only move to next task after testing passes

### **Method 2: TodoWrite Hook System**
Create a wrapper function that:

1. Executes TodoWrite normally
2. Detects when tasks are marked "completed"
3. Analyzes completed task type
4. Automatically invokes appropriate testing agent
5. Reports testing results

### **Method 3: Auto-Testing Agent as Default Subagent**
Register the auto-testing agent as a specialized subagent type that can be invoked directly:

```javascript
Task({
  subagent_type: "task-completion-tester",
  description: "Test nomination voting fix",
  prompt: "I just fixed the database constraint for nomination voting. Please run comprehensive tests..."
})
```

## Triggering Conditions

### **Always Test:**
- Bug fixes (database, frontend, backend)
- New feature implementations
- Form/validation changes
- UI component modifications
- API endpoint changes

### **Skip Testing:**
- Documentation updates
- Configuration changes
- Non-functional refactoring
- Build/deployment scripts

## Integration Workflow

```javascript
// Current: Manual
TodoWrite([...tasks])
// User has to remember to test

// Enhanced: Automatic
enhancedTodoWrite([...tasks]) // Wrapper function
// Automatically triggers:
// 1. TodoWrite execution
// 2. Task analysis
// 3. Auto-testing invocation
// 4. Results reporting
```

## Implementation Files

1. **Enhanced TodoWrite Wrapper**: `agents/enhanced-todo-write.cjs`
2. **Auto-Testing Integration**: `agents/todo-testing-integration.md`
3. **Behavioral Guidelines**: `agents/auto-testing-behavior.md`

This ensures **every completed task is automatically verified** without relying on Claude remembering to invoke testing manually.