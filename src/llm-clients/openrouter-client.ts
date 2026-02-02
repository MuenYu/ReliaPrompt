import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

export class OpenRouterClient implements LLMClient {
    name = "OpenRouter";
    private client: ReturnType<typeof createOpenRouter> | null = null;
    private cachedApiKey: string | null = null;

    private getClient(): ReturnType<typeof createOpenRouter> | null {
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("openrouter_api_key");
        }

        if (!this.cachedApiKey) {
            return null;
        }

        if (!this.client) {
            this.client = createOpenRouter({
                apiKey: this.cachedApiKey,
            });
        }

        return this.client;
    }

    isConfigured(): boolean {
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("openrouter_api_key");
        return !!this.cachedApiKey;
    }

    reset(): void {
        this.cachedApiKey = null;
        this.client = null;
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const apiKey = this.cachedApiKey ?? getConfig("openrouter_api_key");
            if (!apiKey) return [];
            this.cachedApiKey = apiKey;

            const response = await fetch("https://openrouter.ai/api/v1/models", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) return [];

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            const models: ModelInfo[] = [];

            for (const model of data.data ?? []) {
                if (
                    ![
                        "google/gemini-2.5-flash",
                        "qwen/qwen3-235b-a22b-2507",
                        "bytedance-seed/seedream-4.5",
                        "openai/gpt-oss-120b",
                        "openai/gpt-oss-20b",
                        "meta-llama/llama-3.3-70b-instruct",
                        "meta-llama/llama-3.3-8b-instruct",
                    ].includes(model.id)
                ) {
                    continue;
                }
                models.push({
                    id: model.id,
                    name: model.id,
                    provider: this.name,
                });
            }

            models.sort((a, b) => a.name.localeCompare(b.name));
            return models;
        } catch {
            return [];
        }
    }

    private async makeRequest(
        messages: Array<{ role: "system" | "user"; content: string }>,
        modelId: string,
        temperature: number,
        defaultValue: string = ""
    ): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenRouter API key not configured");
        }

        const response = await generateText({
            model: client(modelId),
            messages,
            temperature,
            maxOutputTokens: 4096,
            providerOptions: {
                openrouter: {
                    response_format: { type: "json_object" },
                },
            },
        });

        return response.text || defaultValue;
    }

    async complete(systemPrompt: string, userMessage: string, modelId: string): Promise<string> {
        return this.makeRequest(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            modelId,
            0.1
        );
    }
}

export const openrouterClient = new OpenRouterClient();
