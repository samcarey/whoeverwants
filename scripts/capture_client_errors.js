#!/usr/bin/env node
/**
 * Simple error capture endpoint
 * Add this to your Next.js app to capture client-side errors
 */

// Add this to your Next.js app/api/errors/route.ts:
const errorCaptureCode = `
export async function POST(request) {
  const errorData = await request.json();
  
  console.log('🚨 Client Error Captured:', {
    message: errorData.message,
    stack: errorData.stack,
    url: errorData.url,
    timestamp: new Date().toISOString()
  });
  
  return Response.json({ success: true });
}
`;

// Add this to your app layout or error boundary:
const clientErrorHandler = `
useEffect(() => {
  const handleError = (event) => {
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: event.error?.message || event.message,
        stack: event.error?.stack,
        url: window.location.href
      })
    }).catch(console.error);
  };
  
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', (event) => {
    handleError({
      error: { 
        message: event.reason?.message || 'Unhandled Promise Rejection',
        stack: event.reason?.stack 
      }
    });
  });
  
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleError);
  };
}, []);
`;

console.log('Error Capture Setup:');
console.log('\n1. API Route (app/api/errors/route.ts):');
console.log(errorCaptureCode);
console.log('\n2. Client Handler (add to layout.tsx):');
console.log(clientErrorHandler);