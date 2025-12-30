import { test, expect } from "@playwright/test";
import { e2eServer, type ServerInstance } from "./e2eServer";

// Inline API helpers

interface ModelInfo {
    id: string;
    name: string;
    provider: string;
}

interface ModelSelection {
    provider: string;
    modelId: string;
}

interface Prompt {
    id: number;
    name: string;
    content: string;
}

async function configureDeepseek(baseUrl: string): Promise<void> {
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekApiKey) {
        throw new Error("DEEPSEEK_API_KEY environment variable is not set");
    }

    const response = await fetch(`${baseUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deepseek_api_key: deepseekApiKey }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to configure Deepseek: ${response.statusText} - ${text.slice(0, 200)}`);
    }
}

async function getAvailableModels(baseUrl: string): Promise<ModelInfo[]> {
    const response = await fetch(`${baseUrl}/api/models`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to get models: ${response.statusText} - ${text.slice(0, 200)}`);
    }
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Failed to parse models response as JSON: ${text.slice(0, 200)}`);
    }
}

async function createPrompt(baseUrl: string, name: string, content: string): Promise<Prompt> {
    const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Failed to create prompt: ${response.statusText} - ${text.slice(0, 200)}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Failed to parse prompt response as JSON: ${text.slice(0, 200)}`);
    }
}

async function createTestCase(
    baseUrl: string,
    promptId: number,
    input: string,
    expectedOutput: string,
    expectedOutputType: string
): Promise<void> {
    const response = await fetch(`${baseUrl}/api/prompts/${promptId}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input,
            expected_output: expectedOutput,
            expected_output_type: expectedOutputType,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to create test case: ${response.statusText} - ${text.slice(0, 200)}`);
    }
}

async function clearDatabase(baseUrl: string): Promise<void> {
    const response = await fetch(`${baseUrl}/api/test/clear`, {
        method: "DELETE",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to clear database: ${response.statusText} - ${text.slice(0, 200)}`);
    }
}

test.describe("Auto-Improve E2E", () => {
    let server: ServerInstance | null = null;
    let deepseekModel: ModelSelection | null = null;

    test.beforeEach(async () => {
        server = await e2eServer();
    });

    test.afterEach(async () => {
        if (server) {
            try {
                await clearDatabase(server.baseUrl);
            } catch (error) {
                console.error("Failed to clear database:", error);
            }
        }
        if (server) {
            await server.close();
            server = null;
        }
    });

    test("should run auto-improve with Deepseek", async ({ page }) => {
        if (!server) throw new Error("Server not started");

        await configureDeepseek(server.baseUrl);

        const models = await getAvailableModels(server.baseUrl);
        const deepseekModelInfo = models.find((m) => m.provider === "Deepseek");
        expect(deepseekModelInfo).toBeDefined();
        if (!deepseekModelInfo) {
            throw new Error("Deepseek model not found");
        }

        deepseekModel = {
            provider: deepseekModelInfo.provider,
            modelId: deepseekModelInfo.id,
        };

        await page.goto(`${server.baseUrl}/improve.html`);

        const prompt = await createPrompt(
            server.baseUrl,
            "E2E Improve Test Prompt",
            "You are a helpful assistant that extracts entities from text. Return a JSON array with objects containing 'type' and 'name' fields."
        );

        await createTestCase(
            server.baseUrl,
            prompt.id,
            "Extract entities from: Apple is a company",
            '[{"type": "company", "name": "Apple"}]',
            "array"
        );

        await page.goto(`${server.baseUrl}/improve.html`);

        await page.waitForSelector("#sidebar-prompts", { state: "visible" });

        await page.waitForFunction(() => {
            const sidebar = document.querySelector("#sidebar-prompts");
            return sidebar && !sidebar.textContent?.includes("Loading");
        });

        const promptSelector = page
            .locator("#sidebar-prompts")
            .getByText("E2E Improve Test Prompt")
            .first();
        await promptSelector.waitFor({ state: "visible" });
        await promptSelector.click();

        await page.waitForSelector("#improve-section", { state: "visible" });

        await page.waitForSelector("#improvement-model-selection", { state: "visible" });
        const improvementRadio = page.locator(
            `input[type="radio"][data-provider="Deepseek"][data-model-id="${deepseekModel.modelId}"]`
        );
        await improvementRadio.waitFor({ state: "visible" });
        await improvementRadio.check();

        await page.waitForSelector("#benchmark-models-selection", { state: "visible" });
        const benchmarkCheckbox = page.locator(
            `input[type="checkbox"][data-provider="Deepseek"][data-model-id="${deepseekModel.modelId}"]`
        );
        await benchmarkCheckbox.waitFor({ state: "visible" });
        await benchmarkCheckbox.check();

        const maxIterationsInput = page.locator("#max-iterations");
        await maxIterationsInput.fill("1");

        await page.click("#start-btn");

        await page.waitForSelector("#progress-section", { state: "visible" });

        await page.waitForSelector('#status-badge:has-text("Completed")', { state: "visible" });

        const progressSection = page.locator("#progress-section");
        await expect(progressSection).toBeVisible();

        const logOutput = page.locator("#log-output");
        await expect(logOutput).toBeVisible();
        const logText = await logOutput.textContent();
        expect(logText).toBeTruthy();
        expect(logText!.length).toBeGreaterThan(0);

        const originalScore = page.locator("#original-score");
        const bestScore = page.locator("#best-score");
        await expect(originalScore).toBeVisible();
        await expect(bestScore).toBeVisible();

        const originalScoreText = await originalScore.textContent();
        const bestScoreText = await bestScore.textContent();
        expect(originalScoreText).toMatch(/\d+%|--/); // Should be a percentage or "--"
        expect(bestScoreText).toMatch(/\d+%|--/);
    });
});
