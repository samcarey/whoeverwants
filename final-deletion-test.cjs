#!/usr/bin/env node

/**
 * Final test: Use UI to create poll, submit, edit, delete, verify
 */

const { chromium } = require('playwright');

async function finalDeletionTest() {
  console.log('🎭 Final Deletion Test - Complete UI Flow');
  console.log('==========================================');

  // Use non-headless mode so we can see what's happening
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  try {
    // Go directly to an existing poll that we know has nomination capability
    const testUrl = 'http://localhost:3000/p/00748a10-394c-4b40-a4b1-8c9211e2c53a';
    console.log(`\n📱 Visiting test poll: ${testUrl}`);
    
    await page.goto(testUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check current state
    console.log('\n📊 Checking current poll state...');
    
    const initialState = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundFinalTest = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('FinalTest')) {
          foundFinalTest = true;
          break;
        }
      }
      
      return {
        foundFinalTest,
        pageText: document.body.innerText.slice(0, 500)
      };
    });

    console.log(`   FinalTest already present: ${initialState.foundFinalTest}`);

    // Submit a new nomination "FinalTest"
    console.log('\n🗳️ Submitting nomination "FinalTest"...');
    
    try {
      await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 5000 });
      await page.fill('input[placeholder*="nomination"]', 'FinalTest');
      
      // Try to find name field
      const nameInputs = await page.locator('input[placeholder*="name"]').all();
      if (nameInputs.length > 0) {
        await nameInputs[0].fill('FinalUser');
      }

      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(2000);
      
      // Handle modal if present
      const modalSubmit = page.locator('div[role="dialog"] button:has-text("Submit"), .modal button:has-text("Submit")').first();
      if (await modalSubmit.isVisible()) {
        await modalSubmit.click();
        console.log('   ✅ Confirmed submission via modal');
      }
      
      await page.waitForTimeout(5000); // Wait for submission to complete
      console.log('   ✅ Nomination submitted');
      
    } catch (e) {
      console.log(`   ⚠️ Submission step failed: ${e.message}`);
      console.log('   This might mean we already voted, proceeding to edit...');
    }

    // Check if FinalTest appears
    console.log('\n📊 Checking if FinalTest appears...');
    
    const afterSubmit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundFinalTest = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('FinalTest')) {
          foundFinalTest = true;
          break;
        }
      }
      return foundFinalTest;
    });

    console.log(`   FinalTest visible: ${afterSubmit}`);

    // Try to edit the vote
    console.log('\n✏️ Attempting to edit vote...');
    
    try {
      await page.waitForSelector('button:has-text("Edit")', { timeout: 5000 });
      await page.click('button:has-text("Edit")');
      await page.waitForTimeout(2000);
      console.log('   ✅ Clicked Edit button');

      // Clear all nomination fields
      const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
      console.log(`   Found ${nominationInputs.length} nomination input(s)`);
      
      for (let i = 0; i < nominationInputs.length; i++) {
        await nominationInputs[i].fill('');
      }
      console.log('   ✅ Cleared nomination fields');

      // Submit the edit (this should abstain)
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(2000);
      
      // Handle modal if present
      const editModalSubmit = page.locator('div[role="dialog"] button:has-text("Submit"), .modal button:has-text("Submit")').first();
      if (await editModalSubmit.isVisible()) {
        await editModalSubmit.click();
        console.log('   ✅ Confirmed edit via modal');
      }
      
      await page.waitForTimeout(5000); // Wait for edit to complete
      console.log('   ✅ Edit submitted');
      
    } catch (e) {
      console.log(`   ⚠️ Edit step failed: ${e.message}`);
    }

    // Final check - is FinalTest gone?
    console.log('\n🔍 Final check - is FinalTest deleted?');
    
    const afterEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundFinalTest = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('FinalTest')) {
          foundFinalTest = true;
          break;
        }
      }
      return foundFinalTest;
    });

    console.log(`   FinalTest still visible: ${afterEdit}`);

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    if (afterSubmit && !afterEdit) {
      console.log('🎉 SUCCESS: Nomination deletion works perfectly!');
      console.log('   ✅ Nomination appeared after submission');
      console.log('   ✅ Nomination disappeared after edit/deletion');
      return true;
    } else if (!afterSubmit) {
      console.log('⚠️ INCONCLUSIVE: Could not verify submission worked');
      return false;
    } else if (afterEdit) {
      console.log('❌ FAILURE: Nomination still visible after deletion');
      console.log('   The fix is not working in the UI');
      return false;
    } else {
      console.log('❓ UNEXPECTED: Unusual state');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'final-test-error.png' });
    return false;
  } finally {
    // Keep browser open for 10 seconds for manual inspection
    console.log('\n👀 Keeping browser open for 10 seconds for inspection...');
    await page.waitForTimeout(10000);
    await browser.close();
  }
}

finalDeletionTest()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 FINAL TEST RESULT:', success ? '✅ DELETION WORKS!' : '❌ STILL BROKEN');
    console.log('='.repeat(60));
  });
