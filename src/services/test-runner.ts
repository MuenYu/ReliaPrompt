import {
    createTestJob,
    updateTestJob,
    createTestResult,
    getTestCasesForPrompt,
    getPromptByIdOrFail,
    getConfig,
    TestCase,
    Prompt,
} from "../database";
import { getConfiguredClients, ModelSelection, LLMClient } from "../llm-clients";
import { compare } from "../utils/compare";
import { parse, ParseType } from "../utils/parse";
import { ConfigurationError, getErrorMessage, requireEntity } from "../errors";

// Represents a model to run tests against
export interface ModelRunner {
    client: LLMClient;
    modelId: string;
    displayName: string; // e.g., "OpenAI (gpt-4o)"
}

const DEFAULT_RUNS_PER_TEST = 1;

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
    score: number; // 0-100 average score across all runs
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
    expectedOutput: string;
    runs: RunResult[];
    correctRuns: number;
    averageScore: number; // Average score across all runs for this test case
}

export interface RunResult {
    runNumber: number;
    actualOutput: string | null;
    isCorrect: boolean;
    score: number; // 0-100 percentage score
    expectedFound: number;
    expectedTotal: number;
    unexpectedCount: number;
    error?: string;
    durationMs?: number;
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
    jobId?: string
): Promise<{ score: number; results: LLMTestResult[] }> {
    // Extract prompt content and ID
    const promptContent = typeof prompt === "string" ? prompt : prompt.content;
    const promptId = typeof prompt === "string" ? undefined : prompt.id;

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
        let llmTotalScore = 0;
        let llmCorrectCount = 0;
        let llmTotalRuns = 0;

        const testCasePromises = testCases.map(async (testCase) => {
            const runs: RunResult[] = [];
            let correctRuns = 0;
            let totalScore = 0;

            for (let runNumber = 1; runNumber <= runsPerTest; runNumber++) {
                try {
                    const startTime = Date.now();
                    const actualOutput = await runner.client.complete(
                        promptContent,
                        testCase.input,
                        runner.modelId
                    );
                    const durationMs = Date.now() - startTime;
                    const expectedOutputType = testCase.expectedOutputType as ParseType;
                    const expectedParsed = parse(testCase.expectedOutput, expectedOutputType);
                    const actualParsed = parse(actualOutput, expectedOutputType);
                    const comparison = compare(expectedParsed, actualParsed, expectedOutputType);

                    const isCorrect = comparison.score === 1;
                    if (isCorrect) {
                        correctRuns++;
                        llmCorrectCount++;
                    }
                    totalScore += comparison.score;
                    llmTotalScore += comparison.score;
                    llmTotalRuns++;

                    runs.push({
                        runNumber,
                        actualOutput,
                        isCorrect,
                        score: comparison.score,
                        expectedFound: comparison.expectedFound,
                        expectedTotal: comparison.expectedTotal,
                        unexpectedCount: comparison.unexpectedFound,
                        durationMs,
                    });

                    // Persist to database if jobId is provided
                    if (jobId) {
                        createTestResult(
                            jobId,
                            testCase.id,
                            runner.displayName,
                            runNumber,
                            actualOutput,
                            isCorrect,
                            comparison.score,
                            comparison.expectedFound,
                            comparison.expectedTotal,
                            comparison.unexpectedFound,
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
                        unexpectedCount: 0,
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
                            0
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

            const averageScore = runs.length > 0 ? Math.round(totalScore / runs.length) : 0;

            return {
                testCaseId: testCase.id,
                input: testCase.input,
                expectedOutput: testCase.expectedOutput,
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

        // Calculate average score across all runs
        const averageScore = llmTotalRuns > 0 ? Math.round(llmTotalScore / llmTotalRuns) : 0;

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
    const score = llmResults.length > 0 ? Math.round(totalScore / llmResults.length) : 0;

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
        expectedOutput: string;
        actualOutput: string | null;
        isCorrect: boolean;
        score: number;
        expectedFound: number;
        expectedTotal: number;
        unexpectedCount: number;
    }> = [];

    const testCaseMap = new Map<
        number,
        {
            input: string;
            expectedOutput: string;
            outputs: Array<{
                output: string | null;
                isCorrect: boolean;
                score: number;
                expectedFound: number;
                expectedTotal: number;
                unexpectedCount: number;
            }>;
        }
    >();

    for (const llmResult of results) {
        for (const tcResult of llmResult.testCaseResults) {
            if (!testCaseMap.has(tcResult.testCaseId)) {
                testCaseMap.set(tcResult.testCaseId, {
                    input: tcResult.input,
                    expectedOutput: tcResult.expectedOutput,
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
                    unexpectedCount: run.unexpectedCount,
                });
            }
        }
    }

    for (const [, tc] of testCaseMap) {
        const wrongOutputs = tc.outputs.filter((o) => !o.isCorrect);
        const anyCorrect = tc.outputs.some((o) => o.isCorrect);

        if (wrongOutputs.length > 0) {
            const representative = wrongOutputs[0];
            summary.push({
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                actualOutput: representative.output,
                isCorrect: false,
                score: representative.score,
                expectedFound: representative.expectedFound,
                expectedTotal: representative.expectedTotal,
                unexpectedCount: representative.unexpectedCount,
            });
        } else if (anyCorrect) {
            const correct = tc.outputs.find((o) => o.isCorrect)!;
            summary.push({
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                actualOutput: correct.output,
                isCorrect: true,
                score: correct.score,
                expectedFound: correct.expectedFound,
                expectedTotal: correct.expectedTotal,
                unexpectedCount: correct.unexpectedCount,
            });
        }
    }

    return summary;
}
