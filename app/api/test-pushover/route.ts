import { NextRequest, NextResponse } from 'next/server';
import { sendDevNotification } from '@/lib/pushoverNotifications';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message = 'Test notification from Claude Code' } = body;
    
    // Send a test notification
    await sendDevNotification(message, {
      title: '🧪 Development Test',
      priority: 0,
      sound: 'pushover'
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Test notification sent successfully' 
    });
  } catch (error) {
    console.error('Failed to send test notification:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification', details: error }, 
      { status: 500 }
    );
  }
}

export async function GET() {
  // Simple GET endpoint to test configuration
  const userKey = process.env.PUSHOVER_USER_KEY;
  const appToken = process.env.PUSHOVER_APP_TOKEN;
  
  return NextResponse.json({
    configured: !!(userKey && appToken),
    userKeySet: !!userKey,
    appTokenSet: !!appToken,
    message: 'Pushover configuration status'
  });
}