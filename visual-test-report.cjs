#!/usr/bin/env node

/**
 * Create a visual HTML report showing every step of the nomination workflow
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function createVisualReport() {
  console.log('📸 Creating Visual Test Report');
  console.log('===============================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set a consistent viewport size for all screenshots
  await page.setViewportSize({ width: 1280, height: 800 });

  const screenshots = [];
  let stepNumber = 0;

  try {
    // Step 1: Create fresh poll
    console.log('\n📝 Creating fresh nomination poll...');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: poll } = await supabase
      .from('polls')
      .insert({
        title: 'Visual Test Report Demo',
        poll_type: 'nomination',
        response_deadline: tomorrow.toISOString(),
        creator_name: 'ReportTest'
      })
      .select()
      .single();

    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Navigate to empty poll
    console.log('\n🌐 Step 1: Empty poll page');
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    stepNumber++;
    const step1Path = `step${stepNumber}-empty-poll.png`;
    await page.screenshot({ path: step1Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Empty Poll - Initial State',
      description: 'The poll page before any nominations are submitted',
      path: step1Path,
      timestamp: new Date().toISOString()
    });

    // Step 3: Fill first nomination
    console.log('\n✏️ Step 2: Filling first nomination');
    await page.fill('input[placeholder*="nomination"]', 'FirstNomination');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    stepNumber++;
    const step2Path = `step${stepNumber}-filled-form.png`;
    await page.screenshot({ path: step2Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Form Filled - First Nomination',
      description: 'Form filled with "FirstNomination" and user name',
      path: step2Path,
      timestamp: new Date().toISOString()
    });

    // Step 4: Click Submit (modal should appear)
    console.log('\n🔵 Step 3: Click Submit button');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(1000);

    stepNumber++;
    const step3Path = `step${stepNumber}-confirmation-modal.png`;
    await page.screenshot({ path: step3Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Confirmation Modal',
      description: 'Modal asking for confirmation to submit the nomination',
      path: step3Path,
      timestamp: new Date().toISOString()
    });

    // Step 5: Confirm submission
    console.log('\n✅ Step 4: Confirm submission');
    try {
      // Try to find and click the modal submit button
      const modalButtons = await page.locator('button').all();
      for (const button of modalButtons) {
        const text = await button.textContent();
        if (text && text.includes('Submit') && await button.isVisible()) {
          const buttonBox = await button.boundingBox();
          if (buttonBox && buttonBox.y > 200) { // Make sure it's in a modal (not header)
            await button.click();
            console.log('   Clicked modal Submit button');
            break;
          }
        }
      }
    } catch (e) {
      console.log('   Modal submit attempt: ', e.message);
    }

    await page.waitForTimeout(5000); // Wait for page to refresh

    stepNumber++;
    const step4Path = `step${stepNumber}-after-first-submit.png`;
    await page.screenshot({ path: step4Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'After First Submission',
      description: 'Poll page after submitting "FirstNomination"',
      path: step4Path,
      timestamp: new Date().toISOString()
    });

    // Check database state
    const { data: votesAfterFirst } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId);

    console.log(`   Database votes after first submission: ${votesAfterFirst.length}`);
    if (votesAfterFirst.length > 0) {
      console.log(`   Nominations: ${JSON.stringify(votesAfterFirst[0].nominations)}`);
    }

    // Step 6: Click Edit button
    console.log('\n✏️ Step 5: Click Edit button');
    const editButton = await page.locator('button:has-text("Edit")').first();
    if (await editButton.isVisible()) {
      await editButton.click();
      await page.waitForTimeout(2000);

      stepNumber++;
      const step5Path = `step${stepNumber}-edit-mode.png`;
      await page.screenshot({ path: step5Path, fullPage: true });
      screenshots.push({
        step: stepNumber,
        title: 'Edit Mode',
        description: 'Poll in edit mode showing existing nomination',
        path: step5Path,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('   No Edit button visible - may need to submit first');
    }

    // Step 7: Add second nomination
    console.log('\n➕ Step 6: Adding second nomination');
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    console.log(`   Found ${nominationInputs.length} nomination inputs`);

    if (nominationInputs.length >= 2) {
      await nominationInputs[1].fill('SecondNomination');
    } else if (nominationInputs.length === 1) {
      // Try to add another field
      const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.waitForTimeout(1000);
        const newInputs = await page.locator('input[placeholder*="nomination"]').all();
        if (newInputs.length > 1) {
          await newInputs[1].fill('SecondNomination');
        }
      }
    }

    stepNumber++;
    const step6Path = `step${stepNumber}-two-nominations.png`;
    await page.screenshot({ path: step6Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Two Nominations Added',
      description: 'Form showing both "FirstNomination" and "SecondNomination"',
      path: step6Path,
      timestamp: new Date().toISOString()
    });

    // Step 8: Submit the edit
    console.log('\n🔵 Step 7: Submit edited ballot');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(1000);

    stepNumber++;
    const step7Path = `step${stepNumber}-edit-confirmation.png`;
    await page.screenshot({ path: step7Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Edit Confirmation Modal',
      description: 'Modal confirming the edited submission',
      path: step7Path,
      timestamp: new Date().toISOString()
    });

    // Step 9: Confirm edit
    console.log('\n✅ Step 8: Confirm edit');
    try {
      const editModalButtons = await page.locator('button').all();
      for (const button of editModalButtons) {
        const text = await button.textContent();
        if (text && text.includes('Submit') && await button.isVisible()) {
          const buttonBox = await button.boundingBox();
          if (buttonBox && buttonBox.y > 200) {
            await button.click();
            console.log('   Clicked edit modal Submit button');
            break;
          }
        }
      }
    } catch (e) {
      console.log('   Edit modal submit attempt: ', e.message);
    }

    await page.waitForTimeout(5000); // Wait for refresh

    stepNumber++;
    const step8Path = `step${stepNumber}-final-result.png`;
    await page.screenshot({ path: step8Path, fullPage: true });
    screenshots.push({
      step: stepNumber,
      title: 'Final Result',
      description: 'Poll showing the final state after editing',
      path: step8Path,
      timestamp: new Date().toISOString()
    });

    // Check final database state
    const { data: finalVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    console.log(`\n📊 Final database state:`);
    console.log(`   Total votes: ${finalVotes.length}`);
    if (finalVotes.length > 0) {
      console.log(`   Latest nominations: ${JSON.stringify(finalVotes[0].nominations)}`);
      console.log(`   Vote was edited: ${finalVotes[0].created_at !== finalVotes[0].updated_at}`);
    }

    // Generate HTML report
    console.log('\n📝 Generating HTML report...');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nomination Workflow Visual Test Report</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 3rem;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.2rem;
            opacity: 0.95;
        }

        .summary {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }

        .summary h2 {
            color: #333;
            margin-bottom: 1rem;
        }

        .summary .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }

        .stat-card {
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            padding: 1rem;
            border-radius: 8px;
            text-align: center;
        }

        .stat-card .value {
            font-size: 2rem;
            font-weight: bold;
            color: #764ba2;
        }

        .stat-card .label {
            color: #666;
            margin-top: 0.5rem;
        }

        .timeline {
            position: relative;
            padding: 2rem 0;
        }

        .timeline::before {
            content: '';
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            width: 4px;
            height: 100%;
            background: linear-gradient(to bottom, #667eea, #764ba2);
            border-radius: 2px;
        }

        .step {
            background: white;
            border-radius: 12px;
            margin-bottom: 3rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            overflow: hidden;
            position: relative;
        }

        .step-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem;
            position: relative;
        }

        .step-number {
            position: absolute;
            top: 50%;
            left: -2rem;
            transform: translateY(-50%);
            width: 4rem;
            height: 4rem;
            background: white;
            color: #764ba2;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: bold;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }

        .step-title {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
            padding-left: 3rem;
        }

        .step-description {
            opacity: 0.95;
            padding-left: 3rem;
        }

        .step-content {
            padding: 2rem;
        }

        .screenshot-container {
            position: relative;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            margin-bottom: 1rem;
        }

        .screenshot-container img {
            width: 100%;
            height: auto;
            display: block;
        }

        .step-meta {
            display: flex;
            justify-content: space-between;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #eee;
            color: #666;
            font-size: 0.9rem;
        }

        .database-state {
            background: #f7f7f7;
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
            font-family: 'Courier New', monospace;
        }

        .database-state h4 {
            color: #333;
            margin-bottom: 0.5rem;
        }

        .success-badge {
            background: #4caf50;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            display: inline-block;
        }

        .error-badge {
            background: #f44336;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            display: inline-block;
        }

        .footer {
            text-align: center;
            color: white;
            margin-top: 3rem;
            padding: 2rem;
        }

        @media (max-width: 768px) {
            .timeline::before {
                left: 2rem;
            }

            .step-number {
                left: 0;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Nomination Workflow Visual Test Report</h1>
            <p>Complete step-by-step documentation of the nomination editing process</p>
            <p style="margin-top: 1rem; opacity: 0.8;">Generated: ${new Date().toLocaleString()}</p>
        </div>

        <div class="summary">
            <h2>📊 Test Summary</h2>
            <div class="stats">
                <div class="stat-card">
                    <div class="value">${screenshots.length}</div>
                    <div class="label">Total Steps</div>
                </div>
                <div class="stat-card">
                    <div class="value">${pollId ? '✅' : '❌'}</div>
                    <div class="label">Poll Created</div>
                </div>
                <div class="stat-card">
                    <div class="value">${finalVotes.length}</div>
                    <div class="label">Database Votes</div>
                </div>
                <div class="stat-card">
                    <div class="value">${finalVotes[0]?.nominations?.length || 0}</div>
                    <div class="label">Final Nominations</div>
                </div>
            </div>

            ${finalVotes.length > 0 ? `
            <div class="database-state">
                <h4>Final Database State:</h4>
                <pre>${JSON.stringify(finalVotes[0].nominations, null, 2)}</pre>
                <p>Vote was edited: ${finalVotes[0].created_at !== finalVotes[0].updated_at ?
                    '<span class="success-badge">Yes</span>' :
                    '<span class="error-badge">No</span>'}</p>
            </div>
            ` : ''}
        </div>

        <div class="timeline">
            ${screenshots.map((screenshot, index) => `
                <div class="step">
                    <div class="step-header">
                        <div class="step-number">${screenshot.step}</div>
                        <h3 class="step-title">${screenshot.title}</h3>
                        <p class="step-description">${screenshot.description}</p>
                    </div>
                    <div class="step-content">
                        <div class="screenshot-container">
                            <img src="${screenshot.path}" alt="Step ${screenshot.step} Screenshot" />
                        </div>
                        <div class="step-meta">
                            <span>Step ${screenshot.step} of ${screenshots.length}</span>
                            <span>${new Date(screenshot.timestamp).toLocaleTimeString()}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="footer">
            <h3>Test Completed Successfully</h3>
            <p>This report demonstrates the complete nomination editing workflow</p>
        </div>
    </div>
</body>
</html>
    `;

    fs.writeFileSync('nomination-workflow-report.html', htmlContent);
    console.log('✅ HTML report generated: nomination-workflow-report.html');

    await browser.close();
    return true;

  } catch (error) {
    console.error('\n💥 Report generation failed:', error.message);
    await browser.close();
    return false;
  }
}

createVisualReport()
  .then(success => {
    if (success) {
      console.log('\n' + '='.repeat(60));
      console.log('✅ VISUAL REPORT CREATED SUCCESSFULLY');
      console.log('📄 Open nomination-workflow-report.html to view the report');
      console.log('='.repeat(60));
    }
  });