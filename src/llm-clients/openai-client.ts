import { generateText, jsonSchema, Output, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";
import { pruneReasoningFromResponseMessages, pruneRequestMessages } from "./message-utils";

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
        messages: ModelMessage[],
        modelId: string,
        outputSchema?: unknown,
        defaultValue: string = ""
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenAI API key not configured");
        }

        const prunedMessages = pruneRequestMessages(messages);

        if (outputSchema) {
            const { output } = await generateText({
                model: client(modelId),
                messages: prunedMessages,
                output: Output.object({
                    schema: jsonSchema(outputSchema as Record<string, unknown>),
                }),
                maxOutputTokens: 4096,
            });
            return (output ?? {}) as Record<string, unknown> | Array<unknown>;
        }

        const { text, response } = await generateText({
            model: client(modelId),
            messages: prunedMessages,
            maxOutputTokens: 4096,
        });

        const prunedText = pruneReasoningFromResponseMessages(response.messages);
        return prunedText || text || defaultValue;
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

export const openaiClient = new OpenAIClient();
