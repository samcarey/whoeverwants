import { Page, Locator } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async navigate(path: string) {
    const baseUrl = 'http://localhost:3000';
    const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;
    
    // Handle mobile browser navigation issues with retries
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        // Get browser name to handle webkit-specific issues
        const browserName = this.page.context().browser()?.browserType().name();
        
        const gotoOptions: any = { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        };
        
        // Webkit has issues with service workers causing redirect problems
        if (browserName === 'webkit') {
          // For webkit, try to bypass service worker issues
          await this.page.route('**/*', route => {
            if (route.request().url().includes('service-worker') || 
                route.request().url().includes('sw.js')) {
              route.abort();
            } else {
              route.continue();
            }
          });
        }
        
        await this.page.goto(fullUrl, gotoOptions);
        
        // Wait a moment for any immediate redirects to settle
        await this.page.waitForTimeout(1000);
        
        // Verify we're on the expected path or handle common redirects
        const currentUrl = this.page.url();
        if (path.includes('/create-poll') && currentUrl.includes('/')) {
          // If we got redirected to home, try navigation again
          if (currentUrl === baseUrl + '/' || currentUrl === baseUrl) {
            attempts++;
            console.log(`Navigation attempt ${attempts} redirected to home, retrying...`);
            continue;
          }
        }
        
        // Navigation successful
        break;
        
      } catch (error) {
        attempts++;
        console.log(`Navigation attempt ${attempts} failed:`, error instanceof Error ? error.message : String(error));
        
        if (attempts >= maxAttempts) {
          throw error;
        }
        
        // Wait before retry
        await this.page.waitForTimeout(2000);
      }
    }
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `test-results/${name}.png` });
  }

  // Common elements that appear across pages
  get pageTitle() {
    return this.page.locator('title');
  }

  get loadingSpinner() {
    return this.page.locator('[data-testid="loading"], .animate-spin, .spinner');
  }

  // Wait for any loading to complete
  async waitForNoLoading() {
    try {
      await this.loadingSpinner.waitFor({ state: 'detached', timeout: 5000 });
    } catch {
      // No loading spinner found, continue
    }
  }
}