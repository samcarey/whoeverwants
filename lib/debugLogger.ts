// Client-side debug logger that sends logs to server endpoint
class DebugLogger {
  private isDev: boolean;
  
  constructor() {
    this.isDev = process.env.NODE_ENV === 'development';
  }

  private async sendLog(message: string, level: 'info' | 'warn' | 'error' = 'info', component?: string) {
    // Only log in development mode
    if (!this.isDev) return;
    
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          level,
          component
        })
      });
    } catch (error) {
      // Silently fail to avoid breaking the app
      console.error('Failed to send debug log:', error);
    }
  }

  info(message: string, component?: string) {
    console.log(`[${component || 'DEBUG'}] ${message}`);
    this.sendLog(message, 'info', component);
  }

  warn(message: string, component?: string) {
    console.warn(`[${component || 'DEBUG'}] ${message}`);
    this.sendLog(message, 'warn', component);
  }

  error(message: string, component?: string) {
    console.error(`[${component || 'DEBUG'}] ${message}`);
    this.sendLog(message, 'error', component);
  }

  // Helper method for logging objects
  logObject(label: string, obj: any, component?: string) {
    const message = `${label}: ${JSON.stringify(obj, null, 2)}`;
    this.info(message, component);
  }
}

// Export singleton instance
export const debugLog = new DebugLogger();