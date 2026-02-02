export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
}

export type LLMOutput = string | Record<string, unknown> | Array<unknown>;

export interface LLMClient {
    name: string;
    isConfigured(): boolean;
    listModels(): Promise<ModelInfo[]>;
    complete(
        systemPrompt: string,
        userMessage: string,
        modelId: string,
        outputSchema?: unknown
    ): Promise<LLMOutput>;
}

let activeClients: LLMClient[] = [];

export function setActiveClients(clients: LLMClient[]): void {
    activeClients = clients;
}

export function getConfiguredClients(): LLMClient[] {
    return activeClients.filter((client) => client.isConfigured());
}

export interface ModelSelection {
    provider: string;
    modelId: string;
}

export async function getAllAvailableModels(): Promise<ModelInfo[]> {
    const configuredClients = getConfiguredClients();
    const modelPromises = configuredClients.map((client) => client.listModels());
    const modelArrays = await Promise.all(modelPromises);
    return modelArrays.flat();
}
