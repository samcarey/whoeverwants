#!/usr/bin/env node

// Node.js script to send Pushover notifications when Claude completes tasks
const https = require('https');
const querystring = require('querystring');

// Read environment variables
require('dotenv').config({ path: '/home/ubuntu/whoeverwants/.env' });

const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN;

function sendNotification(message, title = '🤖 Claude Task Complete') {
  const postData = querystring.stringify({
    token: PUSHOVER_APP_TOKEN,
    user: PUSHOVER_USER_KEY,
    title: title,
    message: message,
    priority: 1,
    sound: 'magic'
  });

  const options = {
    hostname: 'api.pushover.net',
    port: 443,
    path: '/1/messages.json',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Notification sent:', message);
          resolve(JSON.parse(data));
        } else {
          console.error('❌ Failed to send notification');
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Get message from command line arguments
const args = process.argv.slice(2);
const message = args[0] || 'Task completed. Please review the changes.';
const title = args[1] || '🤖 Claude Task Complete';

// Send the notification
sendNotification(message, title)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });