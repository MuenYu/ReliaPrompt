import { type ModelMessage } from "ai";
import { LLMClient, ModelInfo } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError, LLMError } from "../errors";
import { pruneReasoningFromResponseMessages, pruneRequestMessages } from "./message-utils";

interface CerebrasModel {
    id: string;
    object: string;
    owned_by: string;
}

interface CerebrasModelsResponse {
    object: string;
    data: CerebrasModel[];
}

export class CerebrasClient implements LLMClient {
    name = "Cerebras";
    private baseUrl = "https://api.cerebras.ai/v1";

    private getApiKey(): string | null {
        return getConfig("cerebras_api_key");
    }

    isConfigured(): boolean {
        return !!this.getApiKey();
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

            const data = (await response.json()) as CerebrasModelsResponse;
            return data.data.map((model) => ({
                id: model.id,
                name: this.formatModelName(model.id),
                provider: "Cerebras",
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
        messages: ModelMessage[],
        temperature: number,
        modelId: string,
        outputSchema?: unknown,
        defaultValue: string = ""
    ): Promise<Record<string, unknown> | Array<unknown> | string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new ConfigurationError("Cerebras API key not configured");
        }

        const prunedMessages = pruneRequestMessages(messages);

        const requestBody: Record<string, unknown> = {
            model: modelId,
            messages: prunedMessages,
            temperature,
            max_tokens: 4096,
        };
        if (outputSchema) {
            requestBody.response_format = { type: "json_object" };
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new LLMError("Cerebras", `API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content ?? defaultValue;
        const prunedText = pruneReasoningFromResponseMessages([
            { role: "assistant", content: content ?? "" },
        ]);
        const sanitizedContent = prunedText || content || defaultValue;
        if (!outputSchema) {
            return sanitizedContent;
        }
        try {
            return JSON.parse(sanitizedContent) as Record<string, unknown> | Array<unknown>;
        } catch {
            throw new LLMError("Cerebras", "Failed to parse JSON response");
        }
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

export const cerebrasClient = new CerebrasClient();
