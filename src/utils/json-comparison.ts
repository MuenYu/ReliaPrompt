/**
 * JSON comparison utility for comparing expected and actual outputs
 * Handles parsing, normalization, and deep equality checks
 */

export interface ComparisonResult {
  isEqual: boolean;
  error?: string;
  expectedParsed?: unknown;
  actualParsed?: unknown;
}

/**
 * Try to parse a string as JSON, handling various edge cases
 */
export function parseJSON(input: string): { success: boolean; value?: unknown; error?: string } {
  if (input === undefined || input === null) {
    return { success: false, error: 'Input is null or undefined' };
  }

  const trimmed = input.trim();
  
  // Handle empty string
  if (trimmed === '') {
    return { success: false, error: 'Input is empty' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return { success: true, value: parsed };
  } catch (e) {
    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        return { success: true, value: parsed };
      } catch {
        // Continue to other fallbacks
      }
    }

    // Try to find JSON-like content
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return { success: true, value: parsed };
      } catch {
        // Fall through
      }
    }

    return { success: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

/**
 * Normalize a value for comparison
 * - Sorts object keys recursively
 * - Handles arrays
 * - Trims strings
 */
export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * Deep equality check for two values
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Handle primitives and null/undefined
  if (a === b) {
    return true;
  }

  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) {
      return false;
    }

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    for (const key of aKeys) {
      if (!(key in bObj)) {
        return false;
      }
      if (!deepEqual(aObj[key], bObj[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Compare expected and actual JSON strings
 * Returns true if they are equivalent (ignoring formatting)
 */
export function compareJSON(expected: string, actual: string): ComparisonResult {
  const expectedResult = parseJSON(expected);
  if (!expectedResult.success) {
    return {
      isEqual: false,
      error: `Failed to parse expected: ${expectedResult.error}`
    };
  }

  const actualResult = parseJSON(actual);
  if (!actualResult.success) {
    return {
      isEqual: false,
      error: `Failed to parse actual: ${actualResult.error}`,
      expectedParsed: expectedResult.value
    };
  }

  const normalizedExpected = normalize(expectedResult.value);
  const normalizedActual = normalize(actualResult.value);

  const isEqual = deepEqual(normalizedExpected, normalizedActual);

  return {
    isEqual,
    expectedParsed: normalizedExpected,
    actualParsed: normalizedActual,
    error: isEqual ? undefined : 'Values do not match'
  };
}

/**
 * Quick check if a string looks like it might be JSON
 */
export function looksLikeJSON(input: string): boolean {
  const trimmed = input.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
         trimmed === 'true' ||
         trimmed === 'false' ||
         trimmed === 'null' ||
         /^-?\d+(\.\d+)?$/.test(trimmed) ||
         (trimmed.startsWith('"') && trimmed.endsWith('"'));
}

