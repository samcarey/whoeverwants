// Client fingerprinting system for secure poll access control
// Generates stable browser fingerprints for session-based access tracking

// Simple hash function to generate consistent fingerprints
function simpleHash(str: string): string {
  let hash = 0;
  if (str.length === 0) return '0';
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Convert to positive hex string and pad to ensure consistent length
  const hex = Math.abs(hash).toString(16);
  
  // Add additional entropy from string length and character distribution
  const lengthComponent = str.length.toString(36);
  const checksumComponent = (str.charCodeAt(0) ^ str.charCodeAt(Math.floor(str.length/2)) ^ str.charCodeAt(str.length-1)).toString(36);
  
  // Combine all components and ensure 32 character result
  const combined = `${hex}${lengthComponent}${checksumComponent}${Math.abs(str.length * 7 + hash).toString(36)}`;
  return combined.padEnd(32, '0').substring(0, 32);
}

// Generate a stable browser fingerprint using available APIs
export function generateClientFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'server-side-placeholder';
  }

  try {
    const components: string[] = [];
    
    // Browser and language info
    components.push(navigator.userAgent || 'unknown-ua');
    components.push(navigator.language || 'unknown-lang');
    components.push((navigator.languages || []).join(',') || 'no-langs');
    
    // Screen characteristics
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth || 24}`);
    components.push(`${screen.availWidth}x${screen.availHeight}`);
    
    // Timezone and locale info
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown-tz');
    components.push(new Date().getTimezoneOffset().toString());
    
    // Platform info
    components.push(navigator.platform || 'unknown-platform');
    components.push(navigator.hardwareConcurrency?.toString() || '0');
    
    // Browser capabilities
    components.push(navigator.cookieEnabled ? '1' : '0');
    components.push(navigator.doNotTrack || 'unspecified');
    
    // WebGL renderer info (if available)
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown-gpu');
        }
      }
    } catch (e) {
      // WebGL not available or blocked
      components.push('no-webgl');
    }
    
    // Create hash of all components using a simple hash algorithm
    const data = components.join('|');
    const fingerprint = simpleHash(data);
    
    return fingerprint;
  } catch (error) {
    console.error('Error generating client fingerprint:', error);
    // Fallback to random string if fingerprinting fails
    return Math.random().toString(36).substring(2, 34);
  }
}

// Get or generate client fingerprint for current session
export function getClientFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'server-side-placeholder';
  }

  // Use sessionStorage for per-session fingerprints (more secure than persistent)
  let fingerprint = sessionStorage.getItem('client_fingerprint');
  
  if (!fingerprint) {
    fingerprint = generateClientFingerprint();
    sessionStorage.setItem('client_fingerprint', fingerprint);
    
    // Also store creation timestamp for debugging
    sessionStorage.setItem('client_fingerprint_created', new Date().toISOString());
  }
  
  return fingerprint;
}

// Regenerate fingerprint (useful for testing or security refresh)
export function regenerateClientFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'server-side-placeholder';
  }

  const newFingerprint = generateClientFingerprint();
  sessionStorage.setItem('client_fingerprint', newFingerprint);
  sessionStorage.setItem('client_fingerprint_created', new Date().toISOString());
  
  return newFingerprint;
}

// Get fingerprint metadata for debugging
export function getFingerprintInfo(): {
  fingerprint: string;
  created: string | null;
  components: string[];
} {
  if (typeof window === 'undefined') {
    return {
      fingerprint: 'server-side-placeholder',
      created: null,
      components: []
    };
  }

  const fingerprint = getClientFingerprint();
  const created = sessionStorage.getItem('client_fingerprint_created');
  
  // Generate components list for debugging (don't include sensitive data)
  const components = [
    `UA: ${navigator.userAgent.substring(0, 50)}...`,
    `Lang: ${navigator.language}`,
    `Screen: ${screen.width}x${screen.height}`,
    `TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `Platform: ${navigator.platform}`
  ];
  
  return {
    fingerprint,
    created,
    components
  };
}

// Validate fingerprint format
export function isValidFingerprint(fingerprint: string): boolean {
  if (!fingerprint || typeof fingerprint !== 'string') {
    return false;
  }
  
  // Check format: should be 32 character alphanumeric string
  return /^[a-zA-Z0-9]{20,40}$/.test(fingerprint);
}

// Initialize fingerprinting on module load
if (typeof window !== 'undefined') {
  // Generate fingerprint on first load
  getClientFingerprint();
  
  // Optional: Log fingerprint info for debugging in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Client fingerprint initialized:', getFingerprintInfo());
  }
}