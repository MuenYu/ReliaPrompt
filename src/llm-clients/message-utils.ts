import { pruneMessages, type ModelMessage } from "ai";

export function pruneRequestMessages(messages: ModelMessage[]): ModelMessage[] {
    return pruneMessages({ messages, reasoning: "all" });
}

export function pruneReasoningFromResponseMessages(messages: ModelMessage[]): string {
    const prunedMessages = pruneMessages({ messages, reasoning: "all" });
    return extractAssistantText(prunedMessages);
}

function extractAssistantText(messages: ModelMessage[]): string {
    return messages
        .filter((message) => message.role === "assistant")
        .map((message) => extractTextContent(message.content))
        .join("");
}

function extractTextContent(content: ModelMessage["content"]): string {
    if (typeof content === "string") {
        return content;
    }
    return content
        .map((part) => {
            if (typeof part === "string") {
                return part;
            }
            if (part.type === "text") {
                return part.text;
            }
            return "";
        })
        .join("");
}
