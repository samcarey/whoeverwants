# Claude Auto-Testing Behavioral Rules

## 🎯 MANDATORY BEHAVIOR: Auto-Testing After Task Completion

### **Rule 1: Always Test Development Tasks**
When Claude marks any development task as "completed" using TodoWrite, Claude MUST immediately run the auto-testing agent via the Task tool.

**Required Pattern:**
```javascript
// Step 1: Complete task
TodoWrite([...tasks with status: "completed"])

// Step 2: IMMEDIATELY invoke auto-testing
Task({
  subagent_type: "general-purpose",
  description: "Auto-test [brief task description]",
  prompt: "Run the auto-testing agent to verify [detailed task description] works correctly. Use: node agents/auto-testing-agent.cjs '[task description]' '[relevant-test-url]'"
})
```

### **Tasks That REQUIRE Auto-Testing:**
✅ **ALWAYS TEST:**
- Bug fixes (frontend, backend, database)
- New feature implementations
- Form validation changes
- UI component modifications
- API endpoint updates
- Database schema changes
- Voting system changes
- Authentication changes
- Performance improvements

❌ **SKIP TESTING:**
- Documentation updates only
- README/markdown file changes
- Configuration file updates (non-functional)
- Comment additions/removals
- Code formatting changes

### **Exception Handling:**
If Claude forgets to run auto-testing after marking a development task complete, Claude must:
1. Acknowledge the oversight
2. Immediately run the auto-testing agent
3. Report the results

### **Integration Points:**

**Current Session (Immediate):**
- Claude will follow this pattern for all remaining tasks in this session
- Any completed development task triggers auto-testing

**Future Sessions:**
- This behavior is documented in the project at `agents/claude-auto-testing-behavior.md`
- Claude should read this file and follow the pattern in future sessions

### **Example Implementation:**

```javascript
// Just completed: "Fix nomination voting database constraint"
TodoWrite([
  {content: "Update database constraint to support nomination votes", status: "completed", activeForm: "..."}
])

// MUST immediately follow with:
Task({
  subagent_type: "general-purpose",
  description: "Test nomination voting fix",
  prompt: "I just fixed the database constraint that was blocking nomination votes. Please run the auto-testing agent to verify nomination voting now works correctly. Test both valid submission and validation error cases using: node agents/auto-testing-agent.cjs 'Database constraint fix for nomination voting' 'http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab'"
})
```

### **Benefits:**
- **Quality Assurance**: Every implementation is verified
- **Regression Prevention**: Catches issues immediately
- **User Confidence**: Proven functionality
- **Documentation**: Test results prove features work
- **Consistency**: No missed testing due to oversight

### **Success Metrics:**
- 100% of development tasks followed by auto-testing
- Zero "forgot to test" incidents
- Comprehensive coverage of all code changes
- Immediate feedback on implementation quality

This behavioral rule ensures **every development task is automatically verified** through systematic auto-testing invocation.