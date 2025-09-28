# GUI Testing Implementation Plan for WhoeverWants

## Executive Summary
This plan outlines the implementation of end-to-end (E2E) GUI testing for the WhoeverWants voting application using Playwright and Puppeteer in a **headless-only environment**. The testing framework is designed specifically for SSH development environments without desktop browser access, making it perfect for remote server development.

## Technology Choice: Playwright vs Puppeteer

### Recommended: **Playwright**
- **Better cross-browser support**: Chrome, Firefox, Safari/WebKit
- **Built-in test runner**: More suitable for E2E testing
- **Auto-wait mechanisms**: Reduces flakiness
- **Better debugging tools**: Trace viewer, video recording, screenshots
- **Network interception**: Built-in request/response mocking
- **Parallel execution**: Native support for parallel test execution

### Alternative: Puppeteer
- Lighter weight for Chrome-only testing
- Simpler API for basic automation
- Better for web scraping tasks

## Project Structure

```
whoeverwants/
├── tests/
│   ├── e2e/                      # New E2E test directory
│   │   ├── config/
│   │   │   ├── playwright.config.ts
│   │   │   └── test.env
│   │   ├── fixtures/
│   │   │   ├── test-data.ts     # Test poll data
│   │   │   └── users.ts         # Test user data
│   │   ├── pages/               # Page Object Model
│   │   │   ├── HomePage.ts
│   │   │   ├── CreatePollPage.ts
│   │   │   ├── PollPage.ts
│   │   │   └── BasePage.ts
│   │   ├── specs/               # Test specifications
│   │   │   ├── poll-creation.spec.ts
│   │   │   ├── voting.spec.ts
│   │   │   ├── poll-results.spec.ts
│   │   │   └── navigation.spec.ts
│   │   └── utils/
│   │       ├── helpers.ts
│   │       └── database.ts      # Test data cleanup
│   └── __tests__/               # Existing unit tests
```

## Implementation Phases

### Phase 1: Setup & Configuration (Week 1)

#### 1.1 Install Dependencies
```bash
npm install --save-dev @playwright/test
npx playwright install  # Install browsers
```

#### 1.2 Create Playwright Configuration
```typescript
// tests/e2e/config/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results.json' }],
    ['junit', { outputFile: 'junit.xml' }]
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,  // REQUIRED: Always run headless for SSH development
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

#### 1.3 Environment Variables
Add testing variables to your existing `.env` file:
```bash
# Add to existing .env file
HEADLESS=true
```
(Uses existing Supabase test database variables)

### Phase 2: Page Object Model Implementation (Week 1-2)

#### 2.1 Base Page Class
```typescript
// tests/e2e/pages/BasePage.ts
import { Page, Locator } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async navigate(path: string) {
    await this.page.goto(path);
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png` });
  }
}
```

#### 2.2 Page-Specific Classes
```typescript
// tests/e2e/pages/CreatePollPage.ts
import { BasePage } from './BasePage';

export class CreatePollPage extends BasePage {
  get titleInput() { return this.page.locator('input[name="title"]'); }
  get descriptionInput() { return this.page.locator('textarea[name="description"]'); }
  get pollTypeSelect() { return this.page.locator('select[name="poll_type"]'); }
  get submitButton() { return this.page.locator('button[type="submit"]'); }

  async createPoll(data: PollData) {
    await this.titleInput.fill(data.title);
    await this.descriptionInput.fill(data.description);
    await this.pollTypeSelect.selectOption(data.type);
    // ... additional fields
    await this.submitButton.click();
  }
}
```

### Phase 3: Core Test Suites (Week 2-3)

#### 3.1 Critical User Journeys

##### Test Suite 1: Poll Creation
```typescript
// tests/e2e/specs/poll-creation.spec.ts
import { test, expect } from '@playwright/test';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Poll Creation', () => {
  test('should create a yes/no poll', async ({ page }) => {
    const createPollPage = new CreatePollPage(page);
    await createPollPage.navigate('/create-poll');
    
    await createPollPage.createPoll({
      title: 'Test Poll',
      description: 'Test Description',
      type: 'yes_no',
      deadline: '2025-12-31'
    });

    await expect(page).toHaveURL(/\/p\/.+/);
    await expect(page.locator('h1')).toContainText('Test Poll');
  });

  test('should create a ranked choice poll', async ({ page }) => {
    // Implementation
  });

  test('should create a nomination poll', async ({ page }) => {
    // Implementation
  });
});
```

##### Test Suite 2: Voting Process
```typescript
// tests/e2e/specs/voting.spec.ts
test.describe('Voting Process', () => {
  test('should submit a yes/no vote', async ({ page }) => {
    // Navigate to poll
    // Cast vote
    // Verify vote recorded
  });

  test('should handle ranked choice voting', async ({ page }) => {
    // Drag and drop ranking
    // Submit vote
    // Verify ranking saved
  });

  test('should edit existing vote', async ({ page }) => {
    // Submit initial vote
    // Edit vote
    // Verify changes saved
  });

  test('should handle abstain option', async ({ page }) => {
    // Select abstain
    // Verify abstain recorded
  });
});
```

##### Test Suite 3: Results Display
```typescript
// tests/e2e/specs/poll-results.spec.ts
test.describe('Poll Results', () => {
  test('should display results after deadline', async ({ page }) => {
    // Create poll with past deadline
    // Verify results visible
  });

  test('should show real-time vote counts', async ({ page }) => {
    // Submit vote
    // Verify count updates
  });

  test('should display ranked choice rounds', async ({ page }) => {
    // Setup ranked choice poll
    // Verify rounds display correctly
  });
});
```

### Phase 4: Advanced Testing Features (Week 3-4)

#### 4.1 Database Integration
```typescript
// tests/e2e/utils/database.ts
import { createClient } from '@supabase/supabase-js';

export class TestDatabase {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL_TEST!,
      process.env.SUPABASE_TEST_SERVICE_KEY!
    );
  }

  async seedTestData() {
    // Insert test polls
    // Insert test votes
  }

  async cleanup() {
    // Delete test data after tests
  }
}
```

#### 4.2 API Mocking
```typescript
// tests/e2e/utils/mocks.ts
export async function mockSupabaseResponses(page: Page) {
  await page.route('**/rest/v1/polls*', route => {
    route.fulfill({
      status: 200,
      body: JSON.stringify({ /* mock data */ })
    });
  });
}
```

#### 4.3 Visual Regression Testing
```typescript
test('visual regression - home page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('home-page.png', {
    maxDiffPixels: 100,
    threshold: 0.2
  });
});
```

### Phase 5: Monitoring & Reporting (Ongoing)

#### 5.1 Test Reports
- HTML reports for local debugging
- JSON reports for automation
- Custom notifications for failures

#### 5.2 Performance Metrics
```typescript
test('performance: page load time', async ({ page }) => {
  const startTime = Date.now();
  await page.goto('/');
  const loadTime = Date.now() - startTime;
  
  expect(loadTime).toBeLessThan(3000); // 3 seconds max
});
```

## NPM Scripts

Add to package.json:
```json
{
  "scripts": {
    "test:e2e": "playwright test --config=tests/e2e/config/playwright.config.ts",
    "test:e2e:verbose": "playwright test --config=tests/e2e/config/playwright.config.ts --reporter=line",
    "test:e2e:report": "playwright show-report",
    "test:e2e:codegen": "playwright codegen http://localhost:3000"
  }
}
```

**Note:** Removed `--headed`, `--debug`, and `--ui` scripts as they require desktop display access.

## Best Practices

### 1. Test Isolation
- Each test should be independent
- Use fresh browser context for each test
- Clean up test data after each test

### 2. Selectors Strategy
Priority order:
1. Data attributes: `data-testid="submit-button"`
2. Role attributes: `role="button"`
3. Text content: `text="Submit"`
4. CSS selectors (last resort)

### 3. Waiting Strategies
- Use Playwright's auto-waiting
- Avoid hard-coded delays (`page.waitForTimeout()`)
- Wait for specific conditions:
  ```typescript
  await page.waitForSelector('[data-testid="results"]');
  await page.waitForLoadState('networkidle');
  ```

### 4. Error Handling
```typescript
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await page.screenshot({ 
      path: `screenshots/failure-${testInfo.title}.png` 
    });
  }
});
```

### 5. Parallel Execution
- Use worker threads for parallel tests
- Group related tests that share setup
- Isolate tests that modify shared state

## SSH Development Environment Setup

### Required Dependencies for Headless Testing
```bash
# Install required dependencies for headless browsers (already available in most environments)
sudo apt-get update
sudo apt-get install -y \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2
```

### Running Tests (SSH-Compatible)
```bash
# Standard headless mode (works over SSH)
npm run test:e2e

# Verbose output for SSH debugging
npm run test:e2e:verbose

# View HTML report (generate and serve)
npm run test:e2e:report
```

### SSH-Friendly Debugging Methods
Since you don't have desktop browser access, use these debugging approaches:

#### 1. **Screenshots on Failure** (Automatic)
```typescript
// Automatically captured in test failures
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    const screenshot = await page.screenshot({ 
      path: `test-results/failure-${testInfo.title}.png`,
      fullPage: true 
    });
  }
});
```

#### 2. **Console Output Debugging**
```bash
# Run with verbose output to see detailed logs
npm run test:e2e:verbose

# Output shows:
# - Test progress and results
# - Page console messages
# - Network requests
# - Timing information
```

#### 3. **HTML Report Viewing**
```bash
# Generate and serve HTML report locally
npm run test:e2e:report

# Then access via your tunnel URL:
# https://decisionbot.a.pinggy.link:9323/
```

#### 4. **File-Based Trace Analysis**
```typescript
// Enable trace recording in config
use: {
  trace: 'retain-on-failure',  // Creates .zip trace files
}

// View traces by downloading and analyzing structure
```

#### 5. **Enhanced Logging for SSH**
```typescript
// Add detailed logging to your tests
test('poll creation', async ({ page }) => {
  console.log('Starting poll creation test...');
  
  await page.goto('/create-poll');
  console.log('Navigated to create-poll page');
  
  await page.fill('[data-testid="title"]', 'Test Poll');
  console.log('Filled title field');
  
  // Take screenshot at key points
  await page.screenshot({ path: 'debug-step-1.png' });
  
  const response = await page.click('[data-testid="submit"]');
  console.log('Clicked submit, response:', response);
});
```

## Success Metrics

### Coverage Goals
- **Critical paths**: 100% coverage
  - Poll creation
  - Voting submission
  - Results display
- **Secondary features**: 80% coverage
  - Poll editing
  - User preferences
  - Navigation

### Performance Targets
- Test suite execution: < 5 minutes
- Individual test: < 30 seconds
- Flakiness rate: < 2%

## Timeline

| Week | Phase | Deliverables |
|------|-------|-------------|
| 1 | Setup & Configuration | Playwright installed, config complete |
| 1-2 | Page Object Model | All page classes implemented |
| 2-3 | Core Test Suites | Critical user journeys covered |
| 3-4 | Advanced Features | API mocking, visual testing |
| Ongoing | Monitoring & Reporting | Test reports, performance metrics |

## Resources & References

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Testing Library Principles](https://testing-library.com/docs/guiding-principles)
- [Page Object Model Pattern](https://martinfowler.com/bliki/PageObject.html)

## Next Steps

1. **Immediate Actions**:
   - Set up Playwright configuration
   - Create first smoke test
   - Establish local test workflow

2. **Short-term Goals** (1 month):
   - Complete core test suites
   - Achieve 80% coverage of critical paths
   - Set up automated reporting

3. **Long-term Goals** (3 months):
   - Full E2E test coverage
   - Visual regression testing
   - Performance benchmarking
   - Cross-browser compatibility verification

## Conclusion

This comprehensive testing strategy will ensure the WhoeverWants application maintains high quality and reliability through automated GUI testing. **The plan is specifically designed for SSH development environments without desktop browser access**, using headless-only testing with robust debugging and reporting capabilities that work entirely through the command line and file-based outputs.