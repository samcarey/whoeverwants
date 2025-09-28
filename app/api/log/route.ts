import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'debug.log');

export async function POST(request: NextRequest) {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Logging only available in development' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { message, level = 'info', component = 'unknown' } = body;
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}\n`;
    
    // Append to log file
    fs.appendFileSync(LOG_FILE, logEntry);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to write log:', error);
    return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
  }
}

export async function GET() {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Logging only available in development' }, { status: 403 });
  }

  try {
    if (!fs.existsSync(LOG_FILE)) {
      return NextResponse.json({ logs: 'No logs yet' });
    }
    
    const logs = fs.readFileSync(LOG_FILE, 'utf-8');
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Failed to read logs:', error);
    return NextResponse.json({ error: 'Failed to read logs' }, { status: 500 });
  }
}

export async function DELETE() {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Logging only available in development' }, { status: 403 });
  }

  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
    return NextResponse.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    console.error('Failed to clear logs:', error);
    return NextResponse.json({ error: 'Failed to clear logs' }, { status: 500 });
  }
}