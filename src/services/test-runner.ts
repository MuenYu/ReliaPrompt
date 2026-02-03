import {
    createTestJob,
    updateTestJob,
    createTestResult,
    getTestCasesForPrompt,
    getPromptByIdOrFail,
    getConfig,
    TestCase,
    Prompt,
    TestResult as DbTestResult,
} from "../database";
import { getConfiguredClients, ModelSelection, LLMClient, openaiClient } from "../llm-clients";
import { ConfigurationError, getErrorMessage, requireEntity } from "../errors";
import { z } from "zod";
import equal from "fast-deep-equal";

// Represents a model to run tests against
export interface ModelRunner {
    client: LLMClient;
    modelId: string;
    displayName: string; // e.g., "OpenAI (gpt-4o)"
}

const DEFAULT_RUNS_PER_TEST = 1;
const DEFAULT_EVALUATION_MODEL = "gpt-5.2";

type EvaluationMode = "llm" | "schema";

type JsonSchema = {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    enum?: unknown[];
    const?: unknown;
    additionalProperties?: boolean | JsonSchema;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    allOf?: JsonSchema[];
};

interface EvaluationResult {
    isCorrect: boolean;
    score: number;
    expectedFound: number;
    expectedTotal: number;
    unexpectedFound: number;
    evaluationReason?: string;
    error?: string;
}

const evaluationResponseSchema = z.object({
    score: z.number().min(0).max(1),
    reason: z
        .string()
        .trim()
        .min(1)
        .refine((value) => countWords(value) <= 100, {
            message: "Reason must be 100 words or fewer",
        }),
});

function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

function normalizeEvaluationMode(mode: unknown): EvaluationMode | undefined {
    if (mode === "llm" || mode === "schema") return mode;
    return undefined;
}

function hasText(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function getSkippedEvaluationResult(): EvaluationResult {
    return {
        isCorrect: true,
        score: 1,
        expectedFound: 0,
        expectedTotal: 0,
        unexpectedFound: 0,
        evaluationReason: "Evaluation skipped",
    };
}

function formatOutputForEvaluation(output: unknown): string {
    const serialized = serializeOutput(output);
    if (serialized === null) return "null";
    return serialized;
}

function getValueType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function matchesType(value: unknown, schemaType: string): boolean {
    switch (schemaType) {
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && !Number.isNaN(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "boolean":
            return typeof value === "boolean";
        case "null":
            return value === null;
        case "array":
            return Array.isArray(value);
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        default:
            return true;
    }
}

function schemaHasType(schema: JsonSchema, schemaType: string): boolean {
    if (!schema.type) return false;
    return Array.isArray(schema.type)
        ? schema.type.includes(schemaType)
        : schema.type === schemaType;
}

function buildJsonSchemaValidator(schema: JsonSchema): z.ZodTypeAny {
    return z.any().superRefine((value, context) => {
        const errors = validateJsonSchema(schema, value);
        if (errors.length > 0) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: errors.slice(0, 5).join("; "),
            });
        }
    });
}

function validateJsonSchema(schema: JsonSchema, value: unknown, path: string = "$"): string[] {
    if (!schema || typeof schema !== "object") {
        return ["Evaluation schema must be an object"];
    }

    const errors: string[] = [];
    const addError = (message: string) => {
        errors.push(`${path}: ${message}`);
    };

    if (schema.allOf && Array.isArray(schema.allOf)) {
        for (const subSchema of schema.allOf) {
            errors.push(...validateJsonSchema(subSchema, value, path));
        }
        return errors;
    }

    if (schema.anyOf && Array.isArray(schema.anyOf)) {
        const anyValid = schema.anyOf.some(
            (subSchema) => validateJsonSchema(subSchema, value, path).length === 0
        );
        if (!anyValid) {
            addError("Value does not match anyOf schemas");
        }
        return errors;
    }

    if (schema.oneOf && Array.isArray(schema.oneOf)) {
        const validCount = schema.oneOf.filter(
            (subSchema) => validateJsonSchema(subSchema, value, path).length === 0
        ).length;
        if (validCount !== 1) {
            addError("Value does not match exactly one schema in oneOf");
        }
        return errors;
    }

    if (schema.const !== undefined && !equal(schema.const, value)) {
        addError("Value does not match const");
        return errors;
    }

    if (schema.enum && Array.isArray(schema.enum)) {
        const matchesEnum = schema.enum.some((item) => equal(item, value));
        if (!matchesEnum) {
            addError("Value does not match enum");
            return errors;
        }
    }

    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        const matches = types.some((type) => matchesType(value, type));
        if (!matches) {
            addError(`Expected type ${types.join("|")}, received ${getValueType(value)}`);
            return errors;
        }
    }

    if (
        (schemaHasType(schema, "object") || schema.properties || schema.required) &&
        value !== null
    ) {
        if (typeof value !== "object" || Array.isArray(value)) {
            addError("Expected object");
            return errors;
        }

        const recordValue = value as Record<string, unknown>;
        const requiredKeys = schema.required ?? [];
        for (const key of requiredKeys) {
            if (!(key in recordValue)) {
                errors.push(`${path}.${key}: Missing required property`);
            }
        }

        const properties = schema.properties ?? {};
        for (const [key, childSchema] of Object.entries(properties)) {
            if (key in recordValue) {
                errors.push(...validateJsonSchema(childSchema, recordValue[key], `${path}.${key}`));
            }
        }

        if (schema.additionalProperties === false) {
            const allowedKeys = new Set(Object.keys(properties));
            for (const key of Object.keys(recordValue)) {
                if (!allowedKeys.has(key)) {
                    errors.push(`${path}.${key}: Unexpected property`);
                }
            }
        }

        if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
            const allowedKeys = new Set(Object.keys(properties));
            for (const [key, childValue] of Object.entries(recordValue)) {
                if (!allowedKeys.has(key)) {
                    errors.push(
                        ...validateJsonSchema(
                            schema.additionalProperties,
                            childValue,
                            `${path}.${key}`
                        )
                    );
                }
            }
        }
    }

    if (schemaHasType(schema, "array") || schema.items) {
        if (!Array.isArray(value)) {
            addError("Expected array");
            return errors;
        }

        if (schema.minItems !== undefined && value.length < schema.minItems) {
            addError(`Expected at least ${schema.minItems} items`);
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            addError(`Expected at most ${schema.maxItems} items`);
        }

        if (schema.items) {
            value.forEach((item, index) => {
                errors.push(...validateJsonSchema(schema.items!, item, `${path}[${index}]`));
            });
        }
    }

    if (schemaHasType(schema, "string") && typeof value === "string") {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            addError(`Expected at least ${schema.minLength} characters`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            addError(`Expected at most ${schema.maxLength} characters`);
        }
        if (schema.pattern) {
            try {
                const regex = new RegExp(schema.pattern);
                if (!regex.test(value)) {
                    addError(`Value does not match pattern ${schema.pattern}`);
                }
            } catch {
                addError("Invalid regex pattern in schema");
            }
        }
    }

    if (
        (schemaHasType(schema, "number") || schemaHasType(schema, "integer")) &&
        typeof value === "number"
    ) {
        if (schema.minimum !== undefined && value < schema.minimum) {
            addError(`Expected number >= ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            addError(`Expected number <= ${schema.maximum}`);
        }
    }

    return errors;
}

async function evaluateWithLLM(options: {
    systemPrompt: string;
    input: string;
    output: unknown;
    evaluationCriteria: string;
}): Promise<EvaluationResult> {
    if (!openaiClient.isConfigured()) {
        return {
            isCorrect: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedFound: 0,
            evaluationReason: "OpenAI API key not configured for LLM evaluation",
            error: "OpenAI API key not configured for LLM evaluation",
        };
    }

    const evaluationPrompt =
        "You are a strict evaluator. Score the model output against the criteria. " +
        "Return only JSON with keys score (0 to 1) and reason (<= 100 words).";

    const evaluationUserMessage =
        `System prompt:\n${options.systemPrompt}\n\n` +
        `User input:\n${options.input}\n\n` +
        `Model output:\n${formatOutputForEvaluation(options.output)}\n\n` +
        `Evaluation criteria:\n${options.evaluationCriteria}\n`;

    const outputSchema = {
        type: "object",
        additionalProperties: false,
        required: ["score", "reason"],
        properties: {
            score: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
        },
    };

    try {
        const response = await openaiClient.complete(
            evaluationPrompt,
            evaluationUserMessage,
            DEFAULT_EVALUATION_MODEL,
            outputSchema
        );

        const parsed = evaluationResponseSchema.safeParse(response);
        if (!parsed.success) {
            return {
                isCorrect: false,
                score: 0,
                expectedFound: 0,
                expectedTotal: 0,
                unexpectedFound: 0,
                evaluationReason: "Evaluation model returned invalid JSON",
                error: "Evaluation model returned invalid JSON",
            };
        }

        const score = parsed.data.score;
        return {
            isCorrect: score === 1,
            score,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedFound: 0,
            evaluationReason: parsed.data.reason,
        };
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        return {
            isCorrect: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedFound: 0,
            evaluationReason: errorMessage,
            error: errorMessage,
        };
    }
}

function evaluateWithSchema(options: {
    evaluationSchema: string;
    output: unknown;
}): EvaluationResult {
    let parsedSchema: JsonSchema;
    try {
        parsedSchema = JSON.parse(options.evaluationSchema) as JsonSchema;
    } catch {
        return {
            isCorrect: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 0,
            unexpectedFound: 0,
            evaluationReason: "Evaluation schema is not valid JSON",
            error: "Evaluation schema is not valid JSON",
        };
    }

    let outputValue: unknown = options.output;
    if (typeof options.output === "string") {
        try {
            outputValue = JSON.parse(options.output);
        } catch {
            outputValue = options.output;
        }
    }

    const validator = buildJsonSchemaValidator(parsedSchema);
    const result = validator.safeParse(outputValue);
    if (!result.success) {
        return {
            isCorrect: false,
            score: 0,
            expectedFound: 0,
            expectedTotal: 1,
            unexpectedFound: 0,
            evaluationReason: result.error.issues.map((issue) => issue.message).join("; "),
            error: result.error.issues.map((issue) => issue.message).join("; "),
        };
    }

    return {
        isCorrect: true,
        score: 1,
        expectedFound: 1,
        expectedTotal: 1,
        unexpectedFound: 0,
        evaluationReason: "Matches evaluation schema",
    };
}

async function evaluateOutput(options: {
    evaluationMode?: EvaluationMode;
    evaluationCriteria?: string | null;
    evaluationSchema?: string | null;
    systemPrompt: string;
    input: string;
    output: unknown;
}): Promise<EvaluationResult> {
    const mode = normalizeEvaluationMode(options.evaluationMode);

    if (mode === "llm") {
        if (!hasText(options.evaluationCriteria)) {
            return getSkippedEvaluationResult();
        }

        return evaluateWithLLM({
            systemPrompt: options.systemPrompt,
            input: options.input,
            output: options.output,
            evaluationCriteria: options.evaluationCriteria.trim(),
        });
    }

    if (mode === "schema") {
        if (!hasText(options.evaluationSchema)) {
            return getSkippedEvaluationResult();
        }

        return evaluateWithSchema({
            evaluationSchema: options.evaluationSchema.trim(),
            output: options.output,
        });
    }

    return getSkippedEvaluationResult();
}

export interface TestProgress {
    jobId: string;
    status: "pending" | "running" | "completed" | "failed";
    totalTests: number;
    completedTests: number;
    progress: number; // 0-100
    results?: TestResults;
    error?: string;
}

export interface TestResults {
    promptId: number;
    promptContent: string;
    totalTestCases: number;
    llmResults: LLMTestResult[];
    overallScore: number;
}

export interface LLMTestResult {
    llmName: string;
    correctCount: number;
    totalRuns: number;
    score: number; // 0-1 average score across all runs
    testCaseResults: TestCaseResult[];
    durationStats?: {
        minMs: number;
        maxMs: number;
        avgMs: number;
    };
}

export interface TestCaseResult {
    testCaseId: number;
    input: string;
    runs: RunResult[];
    correctRuns: number;
    averageScore: number; // Average score across all runs for this test case
}

/**
 * Base type containing common fields shared across test result types.
 * Used by RunResult, TestResultSummary, and database TestResult.
 */
export interface BaseTestResult {
    actualOutput: unknown | null;
    isCorrect: boolean;
    score: number; // 0-1 score
    expectedFound: number;
    expectedTotal: number;
    unexpectedFound: number;
    evaluationReason?: string;
    error?: string;
    durationMs?: number;
}

export interface RunResult extends BaseTestResult {
    runNumber: number;
}

function serializeOutput(output: unknown): string | null {
    if (output === null || output === undefined) {
        return null;
    }
    if (typeof output === "string") {
        return output;
    }
    try {
        const json = JSON.stringify(output);
        return json ?? String(output);
    } catch {
        return String(output);
    }
}

const activeJobs = new Map<string, TestProgress>();

export function getTestProgress(jobId: string): TestProgress | null {
    return activeJobs.get(jobId) ?? null;
}

async function handleTestRun(
    jobId: string,
    prompt: Prompt,
    testCases: TestCase[],
    modelRunners: ModelRunner[],
    runsPerTest: number
): Promise<void> {
    try {
        await runTests(prompt, testCases, modelRunners, runsPerTest, jobId);
    } catch (error) {
        const progress = activeJobs.get(jobId);
        if (progress) {
            progress.status = "failed";
            progress.error = error instanceof Error ? error.message : String(error);
        }
        updateTestJob(jobId, { status: "failed" });
    }
}

function getModelRunnersFromSelections(selectedModels: ModelSelection[]): ModelRunner[] {
    const clients = getConfiguredClients();
    const clientMap = new Map(clients.map((c) => [c.name, c]));
    const runners: ModelRunner[] = [];

    for (const selection of selectedModels) {
        const client = clientMap.get(selection.provider);
        if (client) {
            runners.push({
                client,
                modelId: selection.modelId,
                displayName: `${selection.provider} (${selection.modelId})`,
            });
        }
    }

    return runners;
}

function getSavedModelRunners(): ModelRunner[] {
    // Check for saved selected_models in config
    const savedModelsJson = getConfig("selected_models");
    if (savedModelsJson) {
        try {
            const savedModels = JSON.parse(savedModelsJson) as ModelSelection[];
            if (Array.isArray(savedModels) && savedModels.length > 0) {
                return getModelRunnersFromSelections(savedModels);
            }
        } catch {
            // Fall through to throw error
        }
    }

    throw new ConfigurationError(
        "No models selected. Please select at least one model in settings before running tests."
    );
}

export async function startTestRun(
    promptId: number,
    runsPerTest: number = DEFAULT_RUNS_PER_TEST,
    selectedModels?: ModelSelection[]
): Promise<string> {
    // Use OrFail variant - throws NotFoundError if prompt doesn't exist
    const prompt = getPromptByIdOrFail(promptId);

    const testCases = getTestCasesForPrompt(promptId);
    // Use requireEntity for explicit assertion with clear error message
    requireEntity(testCases.length > 0 ? testCases : null, `Test cases for prompt ${promptId}`);

    // Get model runners based on selection or saved settings
    const modelRunners =
        selectedModels && selectedModels.length > 0
            ? getModelRunnersFromSelections(selectedModels)
            : getSavedModelRunners();

    if (modelRunners.length === 0) {
        throw new ConfigurationError(
            "No LLM models selected. Please select at least one model to run tests."
        );
    }

    const jobId = crypto.randomUUID();
    const totalTests = testCases.length * modelRunners.length * runsPerTest;

    createTestJob(jobId, promptId, totalTests);

    const progress: TestProgress = {
        jobId,
        status: "pending",
        totalTests,
        completedTests: 0,
        progress: 0,
    };
    activeJobs.set(jobId, progress);

    handleTestRun(jobId, prompt, testCases, modelRunners, runsPerTest);

    return jobId;
}

export async function runTests(
    prompt: Prompt | string,
    testCases: TestCase[],
    modelRunners: ModelRunner[],
    runsPerTest: number = DEFAULT_RUNS_PER_TEST,
    jobId?: string,
    expectedSchema?: string
): Promise<{ score: number; results: LLMTestResult[] }> {
    // Extract prompt content and ID
    const promptContent = typeof prompt === "string" ? prompt : prompt.content;
    const promptId = typeof prompt === "string" ? undefined : prompt.id;
    const evaluationMode =
        typeof prompt === "string"
            ? undefined
            : normalizeEvaluationMode(prompt.evaluationMode ?? undefined);
    const evaluationCriteria =
        typeof prompt === "string" ? null : (prompt.evaluationCriteria ?? null);

    // If expectedSchema not passed explicitly, try to get from prompt object
    const schemaString =
        expectedSchema ?? (typeof prompt === "object" ? prompt.expectedSchema : undefined);
    let outputSchema: unknown = undefined;
    if (schemaString) {
        try {
            const parsedSchema = JSON.parse(schemaString);
            outputSchema =
                parsedSchema && typeof parsedSchema === "object" && "schema" in parsedSchema
                    ? (parsedSchema as { schema: unknown }).schema
                    : parsedSchema;
        } catch {
            console.warn("Failed to parse output structure, ignoring structured output");
        }
    }
    if (!outputSchema || typeof outputSchema !== "object") {
        outputSchema = undefined;
    }

    const systemPrompt = promptContent;

    // Initialize progress tracking if jobId is provided
    if (jobId) {
        const progress = activeJobs.get(jobId);
        if (progress) {
            progress.status = "running";
        }
        updateTestJob(jobId, { status: "running" });
    }

    const llmResults: LLMTestResult[] = [];
    let completedTests = 0;
    const totalTests = testCases.length * modelRunners.length * runsPerTest;

    const llmPromises = modelRunners.map(async (runner) => {
        const testCaseResults: TestCaseResult[] = [];
        let llmCorrectCount = 0;
        let llmTotalRuns = 0;

        const testCasePromises = testCases.map(async (testCase) => {
            const runs: RunResult[] = [];
            let correctRuns = 0;
            let totalScore = 0;

            for (let runNumber = 1; runNumber <= runsPerTest; runNumber++) {
                try {
                    const startTime = Date.now();
                    // System prompt includes schema hint if present
                    const actualOutput = await runner.client.complete(
                        systemPrompt,
                        testCase.input,
                        runner.modelId,
                        outputSchema
                    );
                    const normalizedOutput = actualOutput === undefined ? null : actualOutput;
                    const serializedOutput = serializeOutput(normalizedOutput);
                    const durationMs = Date.now() - startTime;

                    const evaluationResult = await evaluateOutput({
                        evaluationMode,
                        evaluationCriteria,
                        evaluationSchema: testCase.evaluationSchema ?? null,
                        systemPrompt,
                        input: testCase.input,
                        output: normalizedOutput,
                    });

                    const isCorrect = evaluationResult.isCorrect;
                    if (isCorrect) {
                        correctRuns++;
                        llmCorrectCount++;
                    }
                    totalScore += evaluationResult.score;
                    llmTotalRuns++;

                    runs.push({
                        runNumber,
                        actualOutput: normalizedOutput,
                        isCorrect,
                        score: evaluationResult.score,
                        expectedFound: evaluationResult.expectedFound,
                        expectedTotal: evaluationResult.expectedTotal,
                        unexpectedFound: evaluationResult.unexpectedFound,
                        evaluationReason: evaluationResult.evaluationReason,
                        error: evaluationResult.error,
                        durationMs,
                    });

                    // Persist to database if jobId is provided
                    if (jobId) {
                        createTestResult(
                            jobId,
                            testCase.id,
                            runner.displayName,
                            runNumber,
                            serializedOutput,
                            isCorrect,
                            evaluationResult.score,
                            evaluationResult.expectedFound,
                            evaluationResult.expectedTotal,
                            evaluationResult.unexpectedFound,
                            evaluationResult.evaluationReason ?? null,
                            durationMs
                        );
                    }
                } catch (error) {
                    llmTotalRuns++;
                    const errorMessage = getErrorMessage(error);
                    runs.push({
                        runNumber,
                        actualOutput: null,
                        isCorrect: false,
                        score: 0,
                        expectedFound: 0,
                        expectedTotal: 0,
                        unexpectedFound: 0,
                        evaluationReason: errorMessage,
                        error: errorMessage,
                    });

                    // Persist to database if jobId is provided
                    if (jobId) {
                        createTestResult(
                            jobId,
                            testCase.id,
                            runner.displayName,
                            runNumber,
                            null,
                            false,
                            0,
                            0,
                            0,
                            0,
                            errorMessage
                        );
                    }
                }

                // Update progress if jobId is provided
                if (jobId) {
                    completedTests++;
                    const progress = activeJobs.get(jobId);
                    if (progress) {
                        progress.completedTests = completedTests;
                        progress.progress = Math.round((completedTests / totalTests) * 100);
                    }
                    updateTestJob(jobId, { completedTests: completedTests });
                }
            }

            const averageScore = runs.length > 0 ? totalScore / runs.length : 0;

            return {
                testCaseId: testCase.id,
                input: testCase.input,
                runs,
                correctRuns,
                averageScore,
            } as TestCaseResult;
        });

        const results = await Promise.all(testCasePromises);
        testCaseResults.push(...results);

        // Calculate duration stats from all runs
        const allDurations = testCaseResults.flatMap((tc) =>
            tc.runs.map((r) => r.durationMs).filter((d): d is number => d !== undefined)
        );
        const durationStats =
            allDurations.length > 0
                ? {
                      minMs: Math.min(...allDurations),
                      maxMs: Math.max(...allDurations),
                      avgMs: Math.round(
                          allDurations.reduce((a, b) => a + b, 0) / allDurations.length
                      ),
                  }
                : undefined;

        // Calculate average score across test cases (not all runs)
        // This gives equal weight to each test case regardless of runs per test
        const totalTestCaseScore = testCaseResults.reduce((sum, tc) => sum + tc.averageScore, 0);
        const averageScore =
            testCaseResults.length > 0 ? totalTestCaseScore / testCaseResults.length : 0;

        return {
            llmName: runner.displayName,
            correctCount: llmCorrectCount,
            totalRuns: llmTotalRuns,
            score: averageScore,
            testCaseResults,
            durationStats,
        } as LLMTestResult;
    });

    const results = await Promise.all(llmPromises);
    llmResults.push(...results);

    // Calculate overall score as average of all LLM scores
    const totalScore = llmResults.reduce((sum, r) => sum + r.score, 0);
    const score = llmResults.length > 0 ? totalScore / llmResults.length : 0;

    // Update job status and results if jobId is provided
    if (jobId) {
        const testResults: TestResults = {
            promptId: promptId ?? 0,
            promptContent: promptContent,
            totalTestCases: testCases.length,
            llmResults,
            overallScore: score,
        };

        const progress = activeJobs.get(jobId);
        if (progress) {
            progress.status = "completed";
            progress.results = testResults;
        }
        updateTestJob(jobId, {
            status: "completed",
            results: JSON.stringify(testResults),
        });
    }

    return { score, results: llmResults };
}

export function getTestResultSummary(results: LLMTestResult[]) {
    const summary: Array<{
        input: string;
        actualOutput: unknown | null;
        isCorrect: boolean;
        score: number;
        expectedFound: number;
        expectedTotal: number;
        unexpectedFound: number;
    }> = [];

    const testCaseMap = new Map<
        number,
        {
            input: string;
            outputs: Array<{
                output: unknown | null;
                isCorrect: boolean;
                score: number;
                expectedFound: number;
                expectedTotal: number;
                unexpectedFound: number;
            }>;
        }
    >();

    for (const llmResult of results) {
        for (const tcResult of llmResult.testCaseResults) {
            if (!testCaseMap.has(tcResult.testCaseId)) {
                testCaseMap.set(tcResult.testCaseId, {
                    input: tcResult.input,
                    outputs: [],
                });
            }

            const tc = testCaseMap.get(tcResult.testCaseId)!;
            for (const run of tcResult.runs) {
                tc.outputs.push({
                    output: run.actualOutput,
                    isCorrect: run.isCorrect,
                    score: run.score,
                    expectedFound: run.expectedFound,
                    expectedTotal: run.expectedTotal,
                    unexpectedFound: run.unexpectedFound,
                });
            }
        }
    }

    for (const [, tc] of testCaseMap) {
        const errorOutput = tc.outputs.find((o) => !o.isCorrect) ?? tc.outputs[0];
        if (errorOutput) {
            summary.push({
                input: tc.input,
                actualOutput: errorOutput.output,
                isCorrect: errorOutput.isCorrect,
                score: errorOutput.score,
                expectedFound: errorOutput.expectedFound,
                expectedTotal: errorOutput.expectedTotal,
                unexpectedFound: errorOutput.unexpectedFound,
            });
        }
    }

    return summary;
}

/**
 * Converts a database TestResult to a RunResult.
 * Handles conversion of isCorrect from integer (0/1) to boolean.
 */
export function dbTestResultToRunResult(dbResult: DbTestResult): RunResult {
    return {
        runNumber: dbResult.runNumber,
        actualOutput: dbResult.actualOutput,
        isCorrect: dbResult.isCorrect === 1,
        score: dbResult.score,
        expectedFound: dbResult.expectedFound,
        expectedTotal: dbResult.expectedTotal,
        unexpectedFound: dbResult.unexpectedFound,
        evaluationReason: dbResult.evaluationReason ?? undefined,
        error: dbResult.error ?? undefined,
        durationMs: dbResult.durationMs ?? undefined,
    };
}

/**
 * Converts a RunResult to a database TestResult format (for creating new records).
 * Note: This returns a partial object - you still need to provide jobId, testCaseId, and llmProvider.
 */
export function runResultToDbTestResult(
    runResult: RunResult,
    jobId: string,
    testCaseId: number,
    llmProvider: string
): Omit<DbTestResult, "id" | "createdAt"> {
    return {
        jobId,
        testCaseId,
        llmProvider,
        runNumber: runResult.runNumber,
        actualOutput: serializeOutput(runResult.actualOutput),
        isCorrect: runResult.isCorrect ? 1 : 0,
        score: runResult.score,
        expectedFound: runResult.expectedFound,
        expectedTotal: runResult.expectedTotal,
        unexpectedFound: runResult.unexpectedFound,
        evaluationReason: runResult.evaluationReason ?? null,
        error: runResult.error ?? null,
        durationMs: runResult.durationMs ?? null,
    };
}
