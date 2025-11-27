import equal from "fast-deep-equal";

export interface ComparisonResult {
    isEqual: boolean;
    score: number; // 0-100 percentage
    expectedFound: number;
    expectedTotal: number;
    unexpectedCount: number;
    error?: string;
    expectedParsed?: unknown;
    actualParsed?: unknown;
}

export function parseJSON(input: string): { success: boolean; value?: unknown; error?: string } {
    if (input === undefined || input === null) {
        return { success: false, error: "Input is null or undefined" };
    }

    const trimmed = input.trim();

    if (trimmed === "") {
        return { success: false, error: "Input is empty" };
    }

    try {
        const parsed = JSON.parse(trimmed);
        return { success: true, value: parsed };
    } catch (e) {
        const errors: string[] = [`Direct parse failed: ${(e as Error).message}`];

        const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            try {
                const parsed = JSON.parse(codeBlockMatch[1].trim());
                return { success: true, value: parsed };
            } catch (codeBlockError) {
                errors.push(`Code block extraction failed: ${(codeBlockError as Error).message}`);
            }
        }

        const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                return { success: true, value: parsed };
            } catch (jsonMatchError) {
                errors.push(`JSON extraction failed: ${(jsonMatchError as Error).message}`);
            }
        }

        return { success: false, error: `Invalid JSON - ${errors.join("; ")}` };
    }
}

/**
 * Get unique values from an array using deep equality.
 * Returns an array of unique elements.
 */
function getUniqueValues(arr: unknown[]): unknown[] {
    const unique: unknown[] = [];
    for (const item of arr) {
        if (!unique.some(u => equal(u, item))) {
            unique.push(item);
        }
    }
    return unique;
}

/**
 * Check if a value exists in an array using deep equality.
 */
function existsInArray(value: unknown, arr: unknown[]): boolean {
    return arr.some(item => equal(item, value));
}

/**
 * Compare two arrays as sets (order-agnostic, unique values).
 * Returns metrics about expected found and unexpected values.
 */
function compareArraysAsSet(expected: unknown[], actual: unknown[]): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedCount: number;
} {
    const uniqueExpected = getUniqueValues(expected);
    const uniqueActual = getUniqueValues(actual);

    let expectedFound = 0;
    for (const expectedItem of uniqueExpected) {
        if (existsInArray(expectedItem, uniqueActual)) {
            expectedFound++;
        }
    }

    let unexpectedCount = 0;
    for (const actualItem of uniqueActual) {
        if (!existsInArray(actualItem, uniqueExpected)) {
            unexpectedCount++;
        }
    }

    return {
        expectedFound,
        expectedTotal: uniqueExpected.length,
        unexpectedCount,
    };
}

/**
 * Compare two objects with partial matching.
 * Tracks correct, missing, and extra keys.
 */
function compareObjects(expected: Record<string, unknown>, actual: Record<string, unknown>): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedCount: number;
} {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);

    let expectedFound = 0;
    for (const key of expectedKeys) {
        if (key in actual && equal(expected[key], actual[key])) {
            expectedFound++;
        }
    }

    // Count keys in actual that don't exist in expected
    let unexpectedCount = 0;
    for (const key of actualKeys) {
        if (!(key in expected)) {
            unexpectedCount++;
        }
    }

    return {
        expectedFound,
        expectedTotal: expectedKeys.length,
        unexpectedCount,
    };
}

/**
 * Calculate comparison metrics for two parsed JSON values.
 * - Arrays: treated as sets (order-agnostic, unique values)
 * - Objects: partial key matching
 * - Primitives: exact match (score 100 or 0)
 */
function calculateMetrics(expected: unknown, actual: unknown): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedCount: number;
} {
    // Handle null
    if (expected === null && actual === null) {
        return { expectedFound: 1, expectedTotal: 1, unexpectedCount: 0 };
    }
    if (expected === null || actual === null) {
        return { expectedFound: 0, expectedTotal: 1, unexpectedCount: actual !== null ? 1 : 0 };
    }

    // Handle arrays - treat as sets
    if (Array.isArray(expected) && Array.isArray(actual)) {
        return compareArraysAsSet(expected, actual);
    }

    // Handle type mismatch between array and non-array
    if (Array.isArray(expected) !== Array.isArray(actual)) {
        const expectedCount = Array.isArray(expected) ? getUniqueValues(expected).length : 1;
        const actualCount = Array.isArray(actual) ? getUniqueValues(actual as unknown[]).length : 1;
        return {
            expectedFound: 0,
            expectedTotal: expectedCount || 1,
            unexpectedCount: actualCount,
        };
    }

    // Handle objects
    if (typeof expected === "object" && typeof actual === "object") {
        return compareObjects(
            expected as Record<string, unknown>,
            actual as Record<string, unknown>
        );
    }

    // Handle primitives (string, number, boolean)
    if (equal(expected, actual)) {
        return { expectedFound: 1, expectedTotal: 1, unexpectedCount: 0 };
    }

    return { expectedFound: 0, expectedTotal: 1, unexpectedCount: 1 };
}

/**
 * Calculate score from metrics.
 * Formula: expectedFound / (expectedTotal + unexpectedCount) * 100
 */
function calculateScore(expectedFound: number, expectedTotal: number, unexpectedCount: number): number {
    const denominator = expectedTotal + unexpectedCount;
    if (denominator === 0) {
        // Edge case: no expected values and no unexpected values
        return 100;
    }
    return Math.round((expectedFound / denominator) * 100);
}

export function compareJSON(expected: string, actual: string): ComparisonResult {
    const expectedResult = parseJSON(expected);
    if (!expectedResult.success) {
        return {
            isEqual: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedCount: 0,
            error: `Failed to parse expected: ${expectedResult.error}`,
        };
    }

    const actualResult = parseJSON(actual);
    if (!actualResult.success) {
        return {
            isEqual: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedCount: 0,
            error: `Failed to parse actual: ${actualResult.error}`,
            expectedParsed: expectedResult.value,
        };
    }

    const metrics = calculateMetrics(expectedResult.value, actualResult.value);
    const score = calculateScore(metrics.expectedFound, metrics.expectedTotal, metrics.unexpectedCount);
    const isEqual = score === 100;

    return {
        isEqual,
        score,
        expectedFound: metrics.expectedFound,
        expectedTotal: metrics.expectedTotal,
        unexpectedCount: metrics.unexpectedCount,
        expectedParsed: expectedResult.value,
        actualParsed: actualResult.value,
        error: isEqual ? undefined : "Values do not match",
    };
}

export function looksLikeJSON(input: string): boolean {
    const trimmed = input.trim();
    return (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        trimmed === "true" ||
        trimmed === "false" ||
        trimmed === "null" ||
        /^-?\d+(\.\d+)?$/.test(trimmed) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
    );
}
