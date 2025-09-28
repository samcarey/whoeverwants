import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'debug-logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log entry with timestamp
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      sessionId: body.sessionId || 'unknown',
      logType: body.logType || 'general',
      level: body.level || 'info',
      message: body.message || '',
      data: body.data || {},
      userAgent: request.headers.get('user-agent') || '',
      url: body.url || request.url,
      stack: body.stack || null
    };

    // Determine log file name based on type and date
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const logFileName = `${body.logType || 'general'}-${date}.log`;
    const logFilePath = path.join(logsDir, logFileName);

    // Format log entry for file
    const logLine = `[${timestamp}] ${body.level?.toUpperCase() || 'INFO'}: ${body.message}\n`;
    const dataLine = body.data && Object.keys(body.data).length > 0
      ? `  DATA: ${JSON.stringify(body.data, null, 2)}\n`
      : '';
    const stackLine = body.stack ? `  STACK: ${body.stack}\n` : '';
    const separator = '---\n';

    const fullLogEntry = logLine + dataLine + stackLine + separator;

    // Append to log file
    fs.appendFileSync(logFilePath, fullLogEntry, 'utf8');

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG-LOG] ${body.logType}:`, logEntry);
    }

    return NextResponse.json({
      success: true,
      logFile: logFileName,
      timestamp
    }, { status: 200 });

  } catch (error) {
    console.error('Error saving debug log:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}