// Client-side debug logger (console output captured by CommitInfo Logs tab)
class DebugLogger {
  info(message: string, component?: string) {
    console.log(`[${component || 'DEBUG'}] ${message}`);
  }

  warn(message: string, component?: string) {
    console.warn(`[${component || 'DEBUG'}] ${message}`);
  }

  error(message: string, component?: string) {
    console.error(`[${component || 'DEBUG'}] ${message}`);
  }

  logObject(label: string, obj: unknown, component?: string) {
    const message = `${label}: ${JSON.stringify(obj, null, 2)}`;
    this.info(message, component);
  }
}

export const debugLog = new DebugLogger();
