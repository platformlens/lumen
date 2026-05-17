/**
 * Redaction Engine — recursively traverses Kubernetes resource objects and
 * replaces sensitive values with `[REDACTED]`.
 *
 * - Pure function: returns a new object without mutating the input
 * - Handles circular references gracefully via WeakSet
 * - Redacts Secret kind resources (data + stringData fields)
 * - Redacts values for keys in SENSITIVE_KEYS
 * - Redacts environment variable values matching SECRET_VALUE_PATTERN
 * - Redacts annotation values containing Bearer tokens or authorization headers
 */

// --- Constants ---

const REDACTED = '[REDACTED]';

/** Keys whose values are always redacted. */
export const SENSITIVE_KEYS: Set<string> = new Set([
  'stringData', 'token', 'accessKey', 'secretKey', 'password',
  'privateKey', 'certificate', 'authorization', 'kubeconfig',
]);

/** Pattern for detecting secret-like values in environment variables. */
export const SECRET_VALUE_PATTERN: RegExp =
  /^(eyJ|AKIA|sk-|ghp_|gho_|github_pat_|xox[bpas]-|Bearer\s)/i;

/** Pattern for detecting Bearer tokens or authorization headers in annotation values. */
const BEARER_ANNOTATION_PATTERN: RegExp = /Bearer\s+\S+/i;

// --- Helpers ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Redact all values in a flat object (used for Secret data/stringData fields).
 */
function redactAllValues(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = REDACTED;
  }
  return result;
}

/**
 * Check if a value in an annotation should be redacted.
 */
function shouldRedactAnnotationValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return BEARER_ANNOTATION_PATTERN.test(value);
}

/**
 * Check if an environment variable value matches a secret pattern.
 */
function isSecretEnvValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return SECRET_VALUE_PATTERN.test(value);
}

// --- Main Redaction Function ---

/**
 * Redact sensitive fields from a Kubernetes resource.
 * Returns a new object — the input is never mutated.
 *
 * Redaction rules:
 * 1. If the resource `kind === 'Secret'`, replace all values in `data` and `stringData` with [REDACTED]
 * 2. For all resources, recursively traverse and redact values for keys in SENSITIVE_KEYS
 * 3. For environment variable arrays (`env` fields), redact `value` if it matches SECRET_VALUE_PATTERN
 * 4. Redact annotation values containing Bearer tokens or authorization headers
 * 5. Handle circular references gracefully (WeakSet to track visited objects)
 */
export function redact(resource: Record<string, unknown>): Record<string, unknown> {
  const visited = new WeakSet<object>();
  const isSecret = resource.kind === 'Secret';
  return redactObject(resource, visited, isSecret, '') as Record<string, unknown>;
}

function redactObject(
  obj: Record<string, unknown>,
  visited: WeakSet<object>,
  isSecret: boolean,
  _parentKey: string,
): Record<string, unknown> {
  // Circular reference protection
  if (visited.has(obj)) {
    return obj;
  }
  visited.add(obj);

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // Rule 1: For Secret resources, redact all values in `data` and `stringData`
    if (isSecret && (key === 'data' || key === 'stringData') && isPlainObject(value)) {
      result[key] = redactAllValues(value);
      continue;
    }

    // Rule 2: Redact values for keys in SENSITIVE_KEYS
    if (SENSITIVE_KEYS.has(key)) {
      if (isPlainObject(value)) {
        // If the sensitive key holds an object (e.g., stringData on non-Secret),
        // redact all its values
        result[key] = redactAllValues(value);
      } else if (Array.isArray(value)) {
        result[key] = REDACTED;
      } else {
        result[key] = REDACTED;
      }
      continue;
    }

    // Rule 4: Redact annotation values containing Bearer tokens
    if (key === 'annotations' && isPlainObject(value)) {
      result[key] = redactAnnotations(value, visited);
      continue;
    }

    // Rule 3: For env arrays, redact values matching SECRET_VALUE_PATTERN
    if (key === 'env' && Array.isArray(value)) {
      result[key] = redactEnvArray(value, visited, isSecret);
      continue;
    }

    // Recurse into nested objects
    if (isPlainObject(value)) {
      result[key] = redactObject(value, visited, isSecret, key);
      continue;
    }

    // Recurse into arrays
    if (Array.isArray(value)) {
      result[key] = redactArray(value, visited, isSecret, key);
      continue;
    }

    // Preserve non-sensitive primitive values
    result[key] = value;
  }

  return result;
}

function redactArray(
  arr: unknown[],
  visited: WeakSet<object>,
  isSecret: boolean,
  parentKey: string,
): unknown[] {
  return arr.map((item) => {
    if (isPlainObject(item)) {
      return redactObject(item, visited, isSecret, parentKey);
    }
    if (Array.isArray(item)) {
      return redactArray(item, visited, isSecret, parentKey);
    }
    return item;
  });
}

function redactAnnotations(
  annotations: Record<string, unknown>,
  visited: WeakSet<object>,
): Record<string, unknown> {
  if (visited.has(annotations)) {
    return annotations;
  }
  visited.add(annotations);

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(annotations)) {
    const value = annotations[key];
    if (shouldRedactAnnotationValue(value)) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function redactEnvArray(
  envArray: unknown[],
  visited: WeakSet<object>,
  isSecret: boolean,
): unknown[] {
  return envArray.map((item) => {
    if (!isPlainObject(item)) return item;

    const envVar = item as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(envVar)) {
      const value = envVar[key];

      // Redact the `value` field if it matches SECRET_VALUE_PATTERN
      if (key === 'value' && isSecretEnvValue(value)) {
        result[key] = REDACTED;
        continue;
      }

      // Recursively handle nested objects (e.g., valueFrom)
      if (isPlainObject(value)) {
        result[key] = redactObject(value, visited, isSecret, key);
        continue;
      }

      result[key] = value;
    }

    return result;
  });
}
