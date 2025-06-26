#!/usr/bin/env node
/**
 * Headless browser test to check for console errors
 * Requires: npm install puppeteer
 */

const puppeteer = require('puppeteer');

async function testPageForErrors(url) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Collect console messages
    const consoleMessages = [];
    page.on('console', msg => {
        consoleMessages.push({
            type: msg.type(),
            text: msg.text(),
            location: msg.location()
        });
    });
    
    // Collect JavaScript errors
    const errors = [];
    page.on('pageerror', error => {
        errors.push({
            message: error.message,
            stack: error.stack
        });
    });
    
    try {
        console.log(`🌐 Testing: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Wait a bit for any async errors
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n📊 Results:');
        console.log(`✅ Page loaded successfully`);
        console.log(`📝 Console messages: ${consoleMessages.length}`);
        console.log(`❌ JavaScript errors: ${errors.length}`);
        
        if (errors.length > 0) {
            console.log('\n🚨 JavaScript Errors:');
            errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error.message}`);
                if (error.stack) {
                    console.log(`   Stack: ${error.stack.split('\n')[0]}`);
                }
            });
        }
        
        if (consoleMessages.filter(msg => msg.type === 'error').length > 0) {
            console.log('\n🚨 Console Errors:');
            consoleMessages
                .filter(msg => msg.type === 'error')
                .forEach((msg, index) => {
                    console.log(`${index + 1}. ${msg.text}`);
                });
        }
        
        return { success: errors.length === 0, errors, consoleMessages };
        
    } catch (error) {
        console.log(`❌ Failed to load page: ${error.message}`);
        return { success: false, errors: [error], consoleMessages };
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    const url = process.argv[2] || 'http://localhost:3000/results/0af70281-1745-4c02-8e09-093956d632f3';
    testPageForErrors(url);
}