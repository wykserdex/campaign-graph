// ═══════════════════════════════════════════════════════════════════════════
// PII Redaction (redactDeep)
// Recursively redacts PII from objects before logging or storing in attributes
// ═══════════════════════════════════════════════════════════════════════════

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: EMAIL_REGEX, replacement: "[REDACTED_EMAIL]" },
  { pattern: PHONE_REGEX, replacement: "[REDACTED_PHONE]" },
  { pattern: CREDIT_CARD_REGEX, replacement: "[REDACTED_CC]" },
  { pattern: SSN_REGEX, replacement: "[REDACTED_SSN]" },
];

const SENSITIVE_FIELD_NAMES = new Set([
  "email",
  "phone",
  "phone_number",
  "ssn",
  "social_security",
  "credit_card",
  "password",
  "secret",
  "token",
  "api_key",
  "private_key",
  "access_token",
  "refresh_token",
]);

/**
 * Recursively deep-redact PII from any value.
 * - Strings are regex-scanned for PII patterns
 * - Objects are recursively traversed
 * - Sensitive field names cause full value redaction
 */
export function redactDeep(value: unknown, fieldName?: string): unknown {
  if (value === null || value === undefined) return value;

  // Check if field name is sensitive → full redaction
  if (
    fieldName &&
    SENSITIVE_FIELD_NAMES.has(fieldName.toLowerCase().replace(/[^a-z_]/g, ""))
  ) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    let result = value;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }

  if (typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = redactDeep(val, key);
    }
    return redacted;
  }

  return value;
}

/**
 * Redact PII from a JSON string.
 * Returns the string with PII patterns replaced.
 */
export function redactJsonString(jsonStr: string): string {
  let result = jsonStr;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
