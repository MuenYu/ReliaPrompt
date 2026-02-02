import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

export class OpenAIClient implements LLMClient {
    name = "OpenAI";
    private client: ReturnType<typeof createOpenAI> | null = null;
    private cachedApiKey: string | null = null;

    private getClient(): ReturnType<typeof createOpenAI> | null {
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("openai_api_key");
        }

        if (!this.cachedApiKey) {
            return null;
        }

        if (!this.client) {
            this.client = createOpenAI({ apiKey: this.cachedApiKey });
        }

        return this.client;
    }

    isConfigured(): boolean {
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("openai_api_key");
        return !!this.cachedApiKey;
    }

    reset(): void {
        this.cachedApiKey = null;
        this.client = null;
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const apiKey = this.cachedApiKey ?? getConfig("openai_api_key");
            if (!apiKey) return [];
            this.cachedApiKey = apiKey;

            const response = await fetch("https://api.openai.com/v1/models", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) return [];

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            const models: ModelInfo[] = [];

            for (const model of data.data ?? []) {
                if (!model.id.startsWith("gpt-5") || model.id.includes("2025")) continue;
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
        defaultValue: string = ""
    ): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenAI API key not configured");
        }

        const response = await generateText({
            model: client(modelId),
            messages,
            maxOutputTokens: 4096,
            providerOptions: {
                openai: {
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
            ""
        );
    }
}

export const openaiClient = new OpenAIClient();
