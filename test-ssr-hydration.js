import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function testSSRHydration(url, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`📍 URL: ${url}`);
  
  try {
    // Fetch the initial HTML (SSR)
    const response = await fetch(url);
    const html = await response.text();
    
    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📏 HTML Length: ${html.length} chars`);
    
    // Check for basic HTML structure
    const hasDoctype = html.includes('<!DOCTYPE html>');
    const hasReactRoot = html.includes('__next') || html.includes('data-reactroot');
    const hasTitle = html.includes('<title>');
    
    console.log(`🏗️  Valid HTML: ${hasDoctype ? '✅' : '❌'}`);
    console.log(`⚛️  React Markers: ${hasReactRoot ? '✅' : '❌'}`);
    console.log(`📄 Has Title: ${hasTitle ? '✅' : '❌'}`);
    
    // Extract title
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1] : 'No title found';
    console.log(`📋 Title: "${title}"`);
    
    // Check for key elements
    const hasCreatePollButton = html.includes('Create Poll');
    const hasGithubLink = html.includes('github.com');
    const hasLoadingSpinner = html.includes('animate-spin');
    
    console.log(`🔘 Create Poll Button: ${hasCreatePollButton ? '✅' : '❌'}`);
    console.log(`🐙 GitHub Link: ${hasGithubLink ? '✅' : '❌'}`);
    console.log(`⏳ Loading Spinner: ${hasLoadingSpinner ? '✅' : '❌'}`);
    
    // Extract the actual rendered HTML body content (before JavaScript payload)
    const bodyMatch = html.match(/<body[^>]*>(.*?)<script>/s);
    const actualBodyContent = bodyMatch ? bodyMatch[1] : '';
    
    // Check for actual 404 errors in the rendered content (not in JS payload)
    const has404InBody = actualBodyContent.includes('404') && actualBodyContent.includes('This page could not be found');
    const hasNotFoundInBody = actualBodyContent.includes('NotFound') || actualBodyContent.includes('HTTPAccessErrorFallback');
    
    // Check for fallback components in JS payload (normal for Next.js)
    const hasNotFoundInPayload = html.includes('NotFound') || html.includes('HTTPAccessErrorFallback');
    const hasErrorBoundary = html.includes('error-boundary');
    
    console.log(`🚫 404 Error in Body: ${has404InBody ? '❌ Found' : '✅ None'}`);
    console.log(`🚨 NotFound in Body: ${hasNotFoundInBody ? '❌ Found' : '✅ None'}`);
    console.log(`📦 NotFound in JS Payload: ${hasNotFoundInPayload ? '⚠️  Normal (Fallback)' : '✅ None'}`);
    console.log(`🛡️  Error Boundary: ${hasErrorBoundary ? '⚠️  Found' : '✅ None'}`);
    
    // Check for React hydration templates
    const hasHydrationTemplates = html.includes('template id="B:') || html.includes('<!--$');
    console.log(`🔄 Hydration Templates: ${hasHydrationTemplates ? '✅ Found' : '❌ Missing'}`);
    
    // Check for JavaScript chunks
    const hasJavaScript = html.includes('/_next/static/chunks/') && html.includes('.js');
    console.log(`📜 JavaScript Chunks: ${hasJavaScript ? '✅ Found' : '❌ Missing'}`);
    
    // Check for any obvious errors in HTML
    const hasJSErrors = html.includes('ReferenceError') || html.includes('SyntaxError');
    const hasConsoleErrors = html.includes('console.error');
    
    console.log(`💥 JS Errors in HTML: ${hasJSErrors ? '❌ Found' : '✅ None'}`);
    console.log(`🚨 Console Errors: ${hasConsoleErrors ? '⚠️  Found' : '✅ None'}`);
    
    // Enhanced content analysis based on actual rendered content
    let contentState = 'Unknown';
    if (actualBodyContent.includes('Welcome to WhoeverWants')) {
      contentState = 'Homepage Rendered Successfully';
    } else if (actualBodyContent.includes('No polls created yet')) {
      contentState = 'Empty State (Expected for Test DB)';
    } else if (actualBodyContent.includes('Failed to load')) {
      contentState = 'Error State';
    } else if (has404InBody) {
      contentState = '404 Error State';
    } else if (hasLoadingSpinner && !actualBodyContent.includes('Welcome')) {
      contentState = 'Loading State (SSR)';
    } else {
      contentState = 'Unknown/Other';
    }
    
    console.log(`📊 Content Analysis: ${contentState}`);
    
    // Score the test
    const positiveChecks = [
      hasDoctype,
      hasTitle, 
      hasCreatePollButton,
      hasGithubLink,
      hasJavaScript,
      !has404InBody,
      !hasNotFoundInBody,
      !hasJSErrors
    ].filter(Boolean).length;
    
    const totalChecks = 8;
    const score = Math.round((positiveChecks / totalChecks) * 100);
    
    console.log(`🎯 Health Score: ${score}% (${positiveChecks}/${totalChecks})`);
    
    return {
      success: score >= 75 && !has404InBody && !hasNotFoundInBody,
      score,
      title,
      contentState,
      hasHydrationIssues: has404InBody || hasNotFoundInBody,
      hasJavaScript,
      responseStatus: response.status
    };
    
  } catch (error) {
    console.log(`💥 Test Failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      score: 0
    };
  }
}

async function runHydrationTests() {
  console.log('🚀 Starting SSR/Hydration Analysis');
  console.log('=' .repeat(60));
  
  const tests = [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Server'
    },
    {
      url: 'https://decisionbot.a.pinggy.link',
      description: 'External Dev Tunnel'
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await testSSRHydration(test.url, test.description);
    results.push({ ...test, ...result });
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('🏁 FINAL RESULTS');
  console.log('=' .repeat(60));
  
  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.description}`);
    console.log(`   URL: ${result.url}`);
    console.log(`   Status: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Score: ${result.score}%`);
    if (result.title) console.log(`   Title: ${result.title}`);
    if (result.contentState) console.log(`   Content: ${result.contentState}`);
    if (result.hasHydrationIssues) console.log(`   ⚠️  Hydration Issues Detected`);
    if (result.error) console.log(`   Error: ${result.error}`);
  });
  
  const passCount = results.filter(r => r.success).length;
  const avgScore = Math.round(results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length);
  
  console.log(`\n🎯 Overall: ${passCount}/${results.length} tests passed`);
  console.log(`📊 Average Score: ${avgScore}%`);
  
  // Recommendations
  console.log('\n💡 RECOMMENDATIONS:');
  if (results.some(r => r.hasHydrationIssues)) {
    console.log('   - Fix hydration errors (404/NotFound components detected)');
  }
  if (results.some(r => !r.hasJavaScript)) {
    console.log('   - Check JavaScript bundle loading');
  }
  if (avgScore < 80) {
    console.log('   - Review SSR implementation and error handling');
  }
  if (results.every(r => r.success)) {
    console.log('   - ✅ All tests passed! SSR and hydration appear healthy');
  }
}

runHydrationTests().catch(console.error);