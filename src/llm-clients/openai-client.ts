import OpenAI from "openai";
import { LLMClient, TestResultSummary, buildImprovementPrompt } from "./llm-client";
import { getConfig } from "../database";
import { ConfigurationError } from "../errors";

export class OpenAIClient implements LLMClient {
    name = "OpenAI";
    private client: OpenAI | null = null;

    private getClient(): OpenAI | null {
        const apiKey = getConfig("openai_api_key");
        if (!apiKey) {
            return null;
        }
        if (!this.client) {
            this.client = new OpenAI({ apiKey });
        }
        return this.client;
    }

    isConfigured(): boolean {
        return !!getConfig("openai_api_key");
    }

    async complete(systemPrompt: string, userMessage: string): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenAI API key not configured");
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 4096,
        });

        return response.choices[0]?.message?.content ?? "";
    }

    async improvePrompt(currentPrompt: string, testResults: TestResultSummary[]): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new ConfigurationError("OpenAI API key not configured");
        }

        const improvementPrompt = buildImprovementPrompt(currentPrompt, testResults);

        const response = await client.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: improvementPrompt }],
            temperature: 0.7,
            max_tokens: 4096,
        });

        return response.choices[0]?.message?.content ?? currentPrompt;
    }
}

export const openaiClient = new OpenAIClient();
