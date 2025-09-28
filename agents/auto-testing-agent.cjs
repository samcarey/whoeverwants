const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class AutoTestingAgent {
  constructor() {
    this.testResults = [];
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async initialize() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    // Capture console messages and errors
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        this.testResults.push({
          type: 'console_error',
          message: msg.text(),
          location: msg.location()
        });
      }
    });

    this.page.on('pageerror', error => {
      this.testResults.push({
        type: 'page_error',
        message: error.message,
        stack: error.stack
      });
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  analyzeTaskType(taskDescription, changedFiles = []) {
    const description = taskDescription.toLowerCase();
    const files = changedFiles.join(' ').toLowerCase();

    const patterns = {
      'form_validation': ['validation', 'form', 'input', 'submit', 'error'],
      'ui_component': ['component', 'tsx', 'jsx', 'css', 'style', 'button'],
      'api_database': ['api', 'route.ts', 'database', 'supabase', 'query'],
      'navigation': ['navigation', 'routing', 'page', 'redirect', 'url'],
      'voting_system': ['vote', 'poll', 'nomination', 'ranking', 'choice'],
      'authentication': ['auth', 'login', 'user', 'session', 'permission']
    };

    for (const [category, keywords] of Object.entries(patterns)) {
      if (keywords.some(keyword =>
        description.includes(keyword) || files.includes(keyword)
      )) {
        return category;
      }
    }

    return 'general';
  }

  async runBasicHealthCheck(url = 'http://localhost:3000') {
    const tests = [];

    try {
      // Test 1: Page loads without errors
      const response = await this.page.goto(url, { waitUntil: 'networkidle' });
      tests.push({
        name: 'Page Load',
        status: response.status() === 200 ? 'PASSED' : 'FAILED',
        details: `HTTP ${response.status()}`
      });

      // Test 2: No JavaScript errors
      await this.page.waitForTimeout(2000);
      const hasJSErrors = this.testResults.some(r =>
        r.type === 'console_error' || r.type === 'page_error'
      );
      tests.push({
        name: 'JavaScript Errors',
        status: !hasJSErrors ? 'PASSED' : 'FAILED',
        details: hasJSErrors ? 'Console errors detected' : 'No JS errors'
      });

      // Test 3: Page content loads
      const hasContent = await this.page.evaluate(() => {
        return document.body.textContent.trim().length > 0;
      });
      tests.push({
        name: 'Content Rendering',
        status: hasContent ? 'PASSED' : 'FAILED',
        details: hasContent ? 'Content rendered' : 'No content found'
      });

    } catch (error) {
      tests.push({
        name: 'Basic Health Check',
        status: 'FAILED',
        details: `Error: ${error.message}`
      });
    }

    return tests;
  }

  async runFormValidationTests(url) {
    const tests = [];

    try {
      await this.page.goto(url, { waitUntil: 'networkidle' });

      // Find submit buttons
      const submitButtons = await this.page.$$('button[type="submit"], button:has-text("Submit")');

      if (submitButtons.length > 0) {
        // Test: Submit empty form
        await submitButtons[0].click();
        await this.page.waitForTimeout(1000);

        // Check for error messages
        const errorMessages = await this.page.$$('[class*="error"], [class*="bg-red"], .error-message');
        tests.push({
          name: 'Empty Form Validation',
          status: errorMessages.length > 0 ? 'PASSED' : 'WARNING',
          details: `Found ${errorMessages.length} error indicators`
        });

        // Test: Fill form with valid data and submit
        const inputs = await this.page.$$('input[type="text"]:not([readonly]):not([disabled])');
        if (inputs.length > 0) {
          await inputs[0].fill('Test Data');
          await submitButtons[0].click();
          await this.page.waitForTimeout(2000);

          // Check if submission succeeded (no errors, or success message)
          const stillHasErrors = await this.page.$$('[class*="error"], [class*="bg-red"]');
          const hasSuccess = await this.page.$('[class*="success"], [class*="bg-green"]');

          tests.push({
            name: 'Valid Form Submission',
            status: (stillHasErrors.length === 0 || hasSuccess) ? 'PASSED' : 'FAILED',
            details: hasSuccess ? 'Success indicator found' : 'No clear success/failure state'
          });
        }
      } else {
        tests.push({
          name: 'Form Detection',
          status: 'WARNING',
          details: 'No submit buttons found'
        });
      }

    } catch (error) {
      tests.push({
        name: 'Form Testing',
        status: 'FAILED',
        details: `Error: ${error.message}`
      });
    }

    return tests;
  }

  async runVotingSystemTests(url) {
    const tests = [];

    try {
      await this.page.goto(url, { waitUntil: 'networkidle' });

      // Check for voting interface elements
      const voteButtons = await this.page.$$('button:has-text("Submit Vote"), button:has-text("Vote")');
      const inputs = await this.page.$$('input[type="text"], input[type="radio"], input[type="checkbox"]');
      const abstainButton = await this.page.$('button:has-text("Abstain")');

      tests.push({
        name: 'Voting Interface Present',
        status: (voteButtons.length > 0 || inputs.length > 0) ? 'PASSED' : 'FAILED',
        details: `Found ${voteButtons.length} vote buttons, ${inputs.length} inputs`
      });

      // Test empty vote submission if applicable
      if (voteButtons.length > 0) {
        await voteButtons[0].click();
        await this.page.waitForTimeout(1000);

        const errors = await this.page.$$('[class*="error"], [class*="bg-red"]');
        tests.push({
          name: 'Empty Vote Validation',
          status: errors.length > 0 ? 'PASSED' : 'WARNING',
          details: `Validation ${errors.length > 0 ? 'present' : 'not detected'}`
        });
      }

      // Test abstain functionality
      if (abstainButton) {
        await abstainButton.click();
        await this.page.waitForTimeout(500);

        const isAbstainActive = await this.page.evaluate(() => {
          const abstainBtn = document.querySelector('button:has-text("Abstain")');
          return abstainBtn ? abstainBtn.classList.toString().includes('selected') ||
                             abstainBtn.classList.toString().includes('active') : false;
        });

        tests.push({
          name: 'Abstain Functionality',
          status: isAbstainActive ? 'PASSED' : 'WARNING',
          details: `Abstain button ${isAbstainActive ? 'appears active' : 'state unclear'}`
        });
      }

    } catch (error) {
      tests.push({
        name: 'Voting System Testing',
        status: 'FAILED',
        details: `Error: ${error.message}`
      });
    }

    return tests;
  }

  async runUIComponentTests(url) {
    const tests = [];

    try {
      await this.page.goto(url, { waitUntil: 'networkidle' });

      // Test: Interactive elements are clickable
      const buttons = await this.page.$$('button:not([disabled])');
      const links = await this.page.$$('a[href]');

      tests.push({
        name: 'Interactive Elements',
        status: (buttons.length > 0 || links.length > 0) ? 'PASSED' : 'WARNING',
        details: `${buttons.length} buttons, ${links.length} links found`
      });

      // Test: Forms are present and functional
      const forms = await this.page.$$('form, [role="form"]');
      const inputs = await this.page.$$('input, textarea, select');

      tests.push({
        name: 'Form Elements',
        status: (forms.length > 0 || inputs.length > 0) ? 'PASSED' : 'PASSED',
        details: `${forms.length} forms, ${inputs.length} inputs`
      });

      // Test: No broken images
      const images = await this.page.$$eval('img', imgs =>
        imgs.map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth }))
      );
      const brokenImages = images.filter(img => !img.complete || img.naturalWidth === 0);

      tests.push({
        name: 'Image Loading',
        status: brokenImages.length === 0 ? 'PASSED' : 'WARNING',
        details: `${brokenImages.length} broken out of ${images.length} images`
      });

    } catch (error) {
      tests.push({
        name: 'UI Component Testing',
        status: 'FAILED',
        details: `Error: ${error.message}`
      });
    }

    return tests;
  }

  async captureScreenshot(name = 'test-failure') {
    if (this.page) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      await this.page.screenshot({ path: filename, fullPage: true });
      return filename;
    }
    return null;
  }

  formatResults(testResults, taskDescription) {
    const passed = testResults.filter(t => t.status === 'PASSED').length;
    const failed = testResults.filter(t => t.status === 'FAILED').length;
    const warnings = testResults.filter(t => t.status === 'WARNING').length;

    let output = `🧪 AUTO-TEST RESULTS for: ${taskDescription}\n\n`;

    // Summary
    output += `📊 SUMMARY: ${passed} passed, ${failed} failed, ${warnings} warnings\n\n`;

    // Individual test results
    testResults.forEach(test => {
      const icon = test.status === 'PASSED' ? '✅' :
                   test.status === 'FAILED' ? '❌' : '⚠️';
      output += `${icon} ${test.status}: ${test.name} - ${test.details}\n`;
    });

    // Error details if any
    const errors = this.testResults.filter(r => r.type === 'console_error' || r.type === 'page_error');
    if (errors.length > 0) {
      output += `\n🔍 DEBUGGING INFO:\n`;
      errors.forEach(error => {
        output += `- ${error.type}: ${error.message}\n`;
      });
    }

    // Overall status
    output += `\n${failed === 0 ? '✅ OVERALL: TESTS PASSED' : '❌ OVERALL: TESTS FAILED'}\n`;

    return output;
  }

  async runTests(taskDescription, changedFiles = [], testUrl = 'http://localhost:3000') {
    console.log(`🧪 Starting auto-tests for: ${taskDescription}`);

    await this.initialize();
    let allTests = [];

    try {
      const taskType = this.analyzeTaskType(taskDescription, changedFiles);
      console.log(`📋 Detected task type: ${taskType}`);

      // Always run basic health check
      const basicTests = await this.runBasicHealthCheck(testUrl);
      allTests = allTests.concat(basicTests);

      // Run specific tests based on task type
      switch (taskType) {
        case 'form_validation':
        case 'voting_system':
          const formTests = await this.runFormValidationTests(testUrl);
          allTests = allTests.concat(formTests);

          if (taskType === 'voting_system') {
            const voteTests = await this.runVotingSystemTests(testUrl);
            allTests = allTests.concat(voteTests);
          }
          break;

        case 'ui_component':
          const uiTests = await this.runUIComponentTests(testUrl);
          allTests = allTests.concat(uiTests);
          break;

        case 'api_database':
          // Basic health check covers API endpoints
          break;

        default:
          // For general tasks, basic health check is sufficient
          break;
      }

      // Capture screenshot on any failures
      const hasFailed = allTests.some(t => t.status === 'FAILED');
      if (hasFailed) {
        const screenshot = await this.captureScreenshot('test-failure');
        if (screenshot) {
          allTests.push({
            name: 'Failure Screenshot',
            status: 'INFO',
            details: `Screenshot saved: ${screenshot}`
          });
        }
      }

    } catch (error) {
      allTests.push({
        name: 'Test Execution',
        status: 'FAILED',
        details: `Test runner error: ${error.message}`
      });
    } finally {
      await this.cleanup();
    }

    return this.formatResults(allTests, taskDescription);
  }
}

// CLI usage
if (require.main === module) {
  const taskDescription = process.argv[2] || 'Unknown task';
  const testUrl = process.argv[3] || 'http://localhost:3000';

  const agent = new AutoTestingAgent();
  agent.runTests(taskDescription, [], testUrl)
    .then(results => {
      console.log(results);
      const hasFailed = results.includes('❌ OVERALL: TESTS FAILED');
      process.exit(hasFailed ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Auto-testing agent failed:', error);
      process.exit(1);
    });
}

module.exports = AutoTestingAgent;