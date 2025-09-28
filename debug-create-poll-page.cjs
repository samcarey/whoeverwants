#!/usr/bin/env node

const { chromium } = require('playwright');

async function debugCreatePollPage() {
  console.log('🔍 Debugging Create Poll Page...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: 'create-poll-debug.png', fullPage: true });
    console.log('📸 Screenshot saved to create-poll-debug.png');

    // Try to find all input elements
    const inputs = await page.$$eval('input', els => els.map(el => ({
      name: el.name,
      placeholder: el.placeholder,
      type: el.type,
      id: el.id,
      className: el.className
    })));
    console.log('Found inputs:', inputs);

    // Try to find all select elements
    const selects = await page.$$eval('select', els => els.map(el => ({
      name: el.name,
      id: el.id,
      className: el.className,
      options: Array.from(el.options).map(opt => ({ value: opt.value, text: opt.text }))
    })));
    console.log('Found selects:', selects);

    // Try to find all buttons
    const buttons = await page.$$eval('button', els => els.map(el => ({
      text: el.textContent,
      className: el.className
    })));
    console.log('Found buttons:', buttons);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

debugCreatePollPage();