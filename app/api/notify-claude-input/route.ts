import { NextRequest, NextResponse } from 'next/server';
import { sendDevNotification } from '@/lib/pushoverNotifications';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, title, priority = 1 } = body;
    
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Send the notification
    await sendDevNotification(message, {
      title: title || '💬 Input Needed',
      priority,
      sound: 'magic'
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Development notification sent successfully' 
    });
  } catch (error) {
    console.error('Failed to send development notification:', error);
    return NextResponse.json(
      { error: 'Failed to send notification' }, 
      { status: 500 }
    );
  }
}