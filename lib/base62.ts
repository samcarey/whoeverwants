// Base62 encoding/decoding utilities for short poll IDs
// Uses: 0-9, A-Z, a-z (62 characters total)

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = 62;

/**
 * Encode a number to base62 string
 */
export function encodeBase62(num: number): string {
  if (num === 0) return '0';
  
  let result = '';
  while (num > 0) {
    result = BASE62_CHARS[num % BASE] + result;
    num = Math.floor(num / BASE);
  }
  
  return result;
}

/**
 * Decode a base62 string to number
 */
export function decodeBase62(encoded: string): number {
  let result = 0;
  
  for (let i = 0; i < encoded.length; i++) {
    const char = encoded[i];
    const charIndex = BASE62_CHARS.indexOf(char);
    
    if (charIndex === -1) {
      throw new Error(`Invalid base62 character: ${char}`);
    }
    
    result = result * BASE + charIndex;
  }
  
  return result;
}