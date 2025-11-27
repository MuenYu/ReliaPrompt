import OpenAI from "openai";
import { LLMClient, ModelInfo, TestResultSummary, buildImprovementPrompt } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

const DEFAULT_MODEL = "gpt-4o";

// OpenAI chat model prefixes to filter relevant models
const CHAT_MODEL_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3"];

export class OpenAIClient implements LLMClient {
    name = "OpenAI";
    private client: OpenAI | null = null;
    private cachedApiKey: string | null = null;

    private getClient(): OpenAI | null {
        // Only read config if we don't have a cached key or client
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("openai_api_key");
        }

        if (!this.cachedApiKey) {
            return null;
        }

        // Create client if it doesn't exist
        if (!this.client) {
            this.client = new OpenAI({ apiKey: this.cachedApiKey });
        }

        return this.client;
    }

    isConfigured(): boolean {
        // Use cached key if available, otherwise read from config
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("openai_api_key");
        return !!this.cachedApiKey;
    }

    /**
     * Reset the cached API key and client. Call this when the config changes.
     */
    reset(): void {
        this.cachedApiKey = null;
        this.client = null;
    }

    async listModels(): Promise<ModelInfo[]> {
        const client = this.getClient();
        if (!client) {
            return [];
        }

        try {
            const response = await client.models.list();
            const models: ModelInfo[] = [];

            for await (const model of response) {
                // Filter for chat models only
                const isChatModel = CHAT_MODEL_PREFIXES.some((prefix) =>
                    model.id.startsWith(prefix)
                );
                if (isChatModel) {
                    models.push({
                        id: model.id,
                        name: model.id,
                        provider: this.name,
                    });
                }
            }

            // Sort by model name
            models.sort((a, b) => a.name.localeCompare(b.name));
            return models;
        } catch {
            // Return empty array if API call fails
            return [];
        }
    }

    private async makeRequest(
        messages: Array<{ role: "system" | "user"; content: string }>,
        temperature: number,
        modelId: string = DEFAULT_MODEL,
        defaultValue: string = ""
    ): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenAI API key not configured");
        }

        const response = await client.chat.completions.create({
            model: modelId,
            messages,
            temperature,
            max_tokens: 4096,
        });

        return response.choices[0]?.message?.content ?? defaultValue;
    }

    async complete(systemPrompt: string, userMessage: string, modelId?: string): Promise<string> {
        return this.makeRequest(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            0.1,
            modelId ?? DEFAULT_MODEL
        );
    }

    async improvePrompt(currentPrompt: string, testResults: TestResultSummary[], modelId?: string): Promise<string> {
        const improvementPrompt = buildImprovementPrompt(currentPrompt, testResults);
        return this.makeRequest([{ role: "user", content: improvementPrompt }], 0.7, modelId ?? DEFAULT_MODEL, currentPrompt);
    }
}

export const openaiClient = new OpenAIClient();
