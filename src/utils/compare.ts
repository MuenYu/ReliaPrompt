import equal from "fast-deep-equal";
import { type ParsedJSON, ParseType } from "./parse";

function getUniqueValues(arr: unknown[]): unknown[] {
    const unique: unknown[] = [];
    for (const item of arr) {
        if (!unique.some((u) => equal(u, item))) {
            unique.push(item);
        }
    }
    return unique;
}

function existsInArray(value: unknown, arr: unknown[]): boolean {
    return arr.some((item) => equal(item, value));
}

function compareArraysAsSet(
    expected: ParsedJSON[],
    output: ParsedJSON[]
): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedFound: number;
} {
    const uniqueExpected = getUniqueValues(expected);
    const uniqueOutput = getUniqueValues(output);

    let expectedFound = 0;
    for (const expectedItem of uniqueExpected) {
        if (existsInArray(expectedItem, uniqueOutput)) {
            expectedFound++;
        }
    }

    let unexpectedFound = 0;
    for (const outputItem of uniqueOutput) {
        if (!existsInArray(outputItem, uniqueExpected)) {
            unexpectedFound++;
        }
    }

    return {
        expectedFound,
        expectedTotal: uniqueExpected.length,
        unexpectedFound,
    };
}

function compareObjects(
    expected: Record<string, ParsedJSON>,
    output: Record<string, ParsedJSON>
): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedFound: number;
} {
    const expectedKeys = Object.keys(expected);
    const outputKeys = Object.keys(output);

    let expectedFound = 0;
    for (const key of expectedKeys) {
        if (key in output && equal(expected[key], output[key])) {
            expectedFound++;
        }
    }

    let unexpectedFound = 0;
    for (const key of outputKeys) {
        if (!(key in expected)) {
            unexpectedFound++;
        }
    }

    return {
        expectedFound,
        expectedTotal: expectedKeys.length,
        unexpectedFound,
    };
}

function calculateMetrics(
    expectedType: ParseType,
    expected: ParsedJSON,
    output: ParsedJSON | undefined
): {
    expectedFound: number;
    expectedTotal: number;
    unexpectedFound: number;
} {
    if (expectedType === ParseType.ARRAY && Array.isArray(expected)) {
        if (Array.isArray(output)) {
            return compareArraysAsSet(expected, output);
        } else {
            return { expectedFound: 0, expectedTotal: expected.length, unexpectedFound: 0 };
        }
    }

    if (expectedType === ParseType.OBJECT && typeof expected === "object") {
        if (typeof output === "object") {
            return compareObjects(
                expected as Record<string, ParsedJSON>,
                output as Record<string, ParsedJSON>
            );
        } else {
            return {
                expectedFound: 0,
                expectedTotal: Object.keys(expected).length,
                unexpectedFound: 0,
            };
        }
    }

    if (expectedType === ParseType.STRING && typeof expected === "string") {
        if (typeof output === "string" && equal(expected, output)) {
            return { expectedFound: 1, expectedTotal: 1, unexpectedFound: 0 };
        }
        return { expectedFound: 0, expectedTotal: 1, unexpectedFound: 0 };
    }

    return { expectedFound: 0, expectedTotal: 0, unexpectedFound: 0 };
}

export function compare(
    expected: ParsedJSON,
    output: ParsedJSON,
    expectedType: ParseType
): {
    score: number;
    expectedTotal: number;
    expectedFound: number;
    unexpectedFound: number;
} {
    if (expected === undefined) {
        throw new Error("Expected value is undefined");
    }

    const metrics = calculateMetrics(expectedType, expected, output);

    let score: number;
    if (metrics.expectedTotal === 0) {
        score = metrics.unexpectedFound === 0 ? 1 : 0;
    } else {
        score = (metrics.expectedFound - metrics.unexpectedFound) / metrics.expectedTotal;
    }

    return {
        score: score < 0 ? 0 : score,
        expectedTotal: metrics.expectedTotal,
        expectedFound: metrics.expectedFound,
        unexpectedFound: metrics.unexpectedFound,
    };
}
