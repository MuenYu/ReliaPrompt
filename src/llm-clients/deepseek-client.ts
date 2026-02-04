import { generateText, jsonSchema, Output, type ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";
import { pruneReasoningFromResponseMessages, pruneRequestMessages } from "./message-utils";

interface DeepseekModel {
    id: string;
    object: string;
    owned_by: string;
}

interface DeepseekModelsResponse {
    object: string;
    data: DeepseekModel[];
}

export class DeepseekClient implements LLMClient {
    name = "Deepseek";
    private baseUrl = "https://api.deepseek.com";
    private cachedApiKey: string | null = null;
    private client: ReturnType<typeof createDeepSeek> | null = null;

    private isTestMode(): boolean {
        return process.env.NODE_ENV === "test";
    }

    private getApiKey(): string | null {
        if (this.cachedApiKey === null) {
            this.cachedApiKey = getConfig("deepseek_api_key");
        }
        return this.cachedApiKey;
    }

    private getClient(): ReturnType<typeof createDeepSeek> | null {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return null;
        }

        if (!this.client) {
            this.client = createDeepSeek({ apiKey });
        }

        return this.client;
    }

    isConfigured(): boolean {
        if (this.cachedApiKey !== null) {
            return !!this.cachedApiKey;
        }
        this.cachedApiKey = getConfig("deepseek_api_key");
        return !!this.cachedApiKey;
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = this.getApiKey();
        if (!apiKey) return [];

        // In test mode we avoid network calls and provide a deterministic model list.
        if (this.isTestMode()) {
            return [
                {
                    id: "deepseek-chat",
                    name: "Deepseek Chat",
                    provider: "Deepseek",
                },
            ];
        }

        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`Deepseek list models failed: ${response.status} - ${error}`);
                return [];
            }

            const data = (await response.json()) as DeepseekModelsResponse;
            return data.data.map((model) => ({
                id: model.id,
                name: this.formatModelName(model.id),
                provider: "Deepseek",
            }));
        } catch (error) {
            console.error("Failed to fetch Deepseek models:", error);
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
        messages: ModelMessage[],
        temperature: number,
        modelId: string,
        outputSchema?: unknown,
        defaultValue: string = ""
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("Deepseek API key not configured");
        }

        const prunedMessages = pruneRequestMessages(messages);

        if (outputSchema) {
            const { output } = await generateText({
                model: client(modelId),
                messages: prunedMessages,
                temperature,
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
            temperature,
            maxOutputTokens: 4096,
        });

        const prunedText = pruneReasoningFromResponseMessages(response.messages);
        return prunedText || text || defaultValue;
    }

    private mockComplete(userMessage: string): string {
        const msg = (userMessage || "").toLowerCase();

        // E2E deterministic response: entity extraction example
        if (msg.includes("microsoft") && msg.includes("bill gates")) {
            return '[{"type":"company","name":"Microsoft"},{"type":"person","name":"Bill Gates"}]';
        }

        // Default to a safe empty JSON array (most tests use array output type)
        return "[]";
    }

    async complete(
        systemPrompt: string,
        userMessage: string,
        modelId: string,
        outputSchema?: unknown
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        if (this.isTestMode()) {
            return this.mockComplete(userMessage);
        }
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

export const deepseekClient = new DeepseekClient();
