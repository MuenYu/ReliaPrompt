import { generateText, generateObject, jsonSchema } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

interface GeminiModel {
    name: string;
    displayName: string;
    description: string;
    supportedGenerationMethods: string[];
}

interface GeminiModelsResponse {
    models: GeminiModel[];
}

export class GeminiClient implements LLMClient {
    name = "Gemini";
    private baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private cachedApiKey: string | null = null;
    private client: ReturnType<typeof createGoogleGenerativeAI> | null = null;

    private getApiKey(): string | null {
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("gemini_api_key");
        }
        return this.cachedApiKey;
    }

    private getClient(): ReturnType<typeof createGoogleGenerativeAI> | null {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return null;
        }

        if (!this.client) {
            this.client = createGoogleGenerativeAI({ apiKey });
        }

        return this.client;
    }

    isConfigured(): boolean {
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("gemini_api_key");
        return !!this.cachedApiKey;
    }

    reset(): void {
        this.cachedApiKey = null;
        this.client = null;
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return [];
        }

        try {
            const response = await fetch(`${this.baseUrl}/models?key=${apiKey}`, {
                method: "GET",
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`Gemini list models failed: ${response.status} - ${error}`);
                return [];
            }

            const data = (await response.json()) as GeminiModelsResponse;
            return data.models
                .filter((model) => model.supportedGenerationMethods.includes("generateContent"))
                .filter((model) => model.displayName.includes("Gemini 3"))
                .map((model) => ({
                    id: model.name.replace("models/", ""),
                    name: model.displayName,
                    provider: this.name,
                }));
        } catch (error) {
            console.error("Failed to fetch Gemini models:", error);
            return [];
        }
    }

    private async makeRequest(
        messages: Array<{ role: "system" | "user"; content: string }>,
        modelId: string,
        outputSchema?: unknown,
        defaultValue: string = ""
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("Gemini API key not configured");
        }

        if (outputSchema) {
            const response = await generateObject({
                model: client(modelId),
                messages,
                schema: jsonSchema(outputSchema as Record<string, unknown>),
                maxOutputTokens: 4096,
            });
            return (response.object ?? {}) as Record<string, unknown> | Array<unknown>;
        }

        const response = await generateText({
            model: client(modelId),
            messages,
            maxOutputTokens: 4096,
        });

        return response.text || defaultValue;
    }

    async complete(
        systemPrompt: string,
        userMessage: string,
        modelId: string,
        outputSchema?: unknown
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        return this.makeRequest(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            modelId,
            outputSchema,
            ""
        );
    }
}

export const geminiClient = new GeminiClient();
