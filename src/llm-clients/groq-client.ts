import { generateText, generateObject, jsonSchema } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

interface GroqModel {
    id: string;
    object: string;
    owned_by: string;
}

interface GroqModelsResponse {
    object: string;
    data: GroqModel[];
}

export class GroqClient implements LLMClient {
    name = "Groq";
    private baseUrl = "https://api.groq.com/openai/v1";
    private cachedApiKey: string | null = null;
    private client: ReturnType<typeof createGroq> | null = null;

    private getApiKey(): string | null {
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("groq_api_key");
        }
        return this.cachedApiKey;
    }

    private getClient(): ReturnType<typeof createGroq> | null {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return null;
        }

        if (!this.client) {
            this.client = createGroq({ apiKey });
        }

        return this.client;
    }

    isConfigured(): boolean {
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("groq_api_key");
        return !!this.cachedApiKey;
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return [];
        }

        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) return [];

            const data = (await response.json()) as GroqModelsResponse;
            return data.data.map((model) => ({
                id: model.id,
                name: this.formatModelName(model.id),
                provider: "Groq",
            }));
        } catch {
            return [];
        }
    }

    private formatModelName(modelId: string): string {
        return modelId
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }

    private async makeRequest(
        messages: Array<{ role: "system" | "user"; content: string }>,
        temperature: number,
        modelId: string,
        outputSchema?: unknown,
        defaultValue: string = ""
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("Groq API key not configured");
        }

        if (outputSchema) {
            const response = await generateObject({
                model: client(modelId),
                messages,
                temperature,
                schema: jsonSchema(outputSchema as Record<string, unknown>),
                maxOutputTokens: 4096,
            });
            return (response.object ?? {}) as Record<string, unknown> | Array<unknown>;
        }

        const response = await generateText({
            model: client(modelId),
            messages,
            temperature,
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
            0.1,
            modelId,
            outputSchema,
            ""
        );
    }
}

export const groqClient = new GroqClient();
