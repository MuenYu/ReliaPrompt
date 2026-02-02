import { z } from "zod";
import { ParseType } from "../utils/parse";

const jsonStringSchema = (invalidMessage: string) =>
    z
        .string()
        .trim()
        .superRefine((value, context) => {
            try {
                JSON.parse(value);
            } catch {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: invalidMessage,
                });
            }
        });

const optionalJsonStringSchema = (invalidMessage: string, allowNull = false) =>
    z.preprocess((value) => {
        if (value === undefined) return undefined;
        if (allowNull && value === null) return undefined;
        if (typeof value === "string" && value.trim() === "") return undefined;
        return value;
    }, jsonStringSchema(invalidMessage).optional());

const requiredJsonStringSchema = (
    requiredMessage: string,
    emptyMessage: string,
    invalidMessage: string
) =>
    z
        .string({ message: requiredMessage })
        .trim()
        .min(1, { message: emptyMessage })
        .superRefine((value, context) => {
            try {
                JSON.parse(value);
            } catch {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: invalidMessage,
                });
            }
        });

const expectedOutputTypeSchema = z
    .string({ message: "expected_output_type is required" })
    .refine((value) => Object.values(ParseType).includes(value as ParseType), {
        message: "expected_output_type must be one of: string, array, object",
    });

// Common schemas
export const idParamSchema = z
    .object({
        id: z.string().regex(/^\d+$/, { message: "id must be a valid integer" }),
    })
    .strict();

export const jobIdParamSchema = z
    .object({
        jobId: z.string().uuid({ message: "jobId must be a valid UUID" }),
    })
    .strict();

// Model selection schema
export const modelSelectionSchema = z
    .object({
        provider: z.string(),
        modelId: z.string(),
    })
    .strict();

// Config schemas
export const configBodySchema = z
    .object({
        openai_api_key: z.string().optional(),
        cerebras_api_key: z.string().optional(),
        deepseek_api_key: z.string().optional(),
        gemini_api_key: z.string().optional(),
        groq_api_key: z.string().optional(),
        openrouter_api_key: z.string().optional(),
        selected_models: z
            .union([
                z.array(modelSelectionSchema),
                z.string(), // Allow JSON string for backward compatibility
            ])
            .optional(),
    })
    .strict();

// Prompt schemas
export const createPromptSchema = z
    .object({
        name: z
            .string({ message: "Name is required" })
            .trim()
            .min(1, { message: "Name cannot be empty" }),
        content: z
            .string({ message: "Content is required" })
            .trim()
            .min(1, { message: "Content cannot be empty" }),
        expectedSchema: optionalJsonStringSchema("Expected schema must be valid JSON"),
        parentVersionId: z.coerce.number().int().positive().optional(),
    })
    .strict();

// Test case schemas
export const createTestCaseSchema = z
    .object({
        input: z
            .string({ message: "Input is required" })
            .trim()
            .min(1, { message: "Input cannot be empty" }),
        expected_output: requiredJsonStringSchema(
            "Expected output is required",
            "Expected output cannot be empty",
            "Expected output must be valid JSON"
        ),
        expected_output_type: expectedOutputTypeSchema.optional().default(ParseType.ARRAY),
    })
    .strict();

export const updateTestCaseSchema = z
    .object({
        input: z
            .string({ message: "Input is required" })
            .trim()
            .min(1, { message: "Input cannot be empty" }),
        expected_output: requiredJsonStringSchema(
            "Expected output is required",
            "Expected output cannot be empty",
            "Expected output must be valid JSON"
        ),
        expected_output_type: expectedOutputTypeSchema,
    })
    .strict();

export const importTestCasesSchema = z
    .array(createTestCaseSchema, { message: "Test cases must be an array" })
    .min(0);

// Import prompts schema
const importPromptItemSchema = z
    .object({
        name: z
            .string({ message: "Name is required" })
            .trim()
            .min(1, { message: "Name cannot be empty" }),
        content: z
            .string({ message: "Content is required" })
            .trim()
            .min(1, { message: "Content cannot be empty" }),
        expected_schema: optionalJsonStringSchema("expected_schema must be valid JSON", true),
    })
    .strict();

export const importPromptsSchema = z
    .array(importPromptItemSchema, { message: "Prompts must be an array" })
    .min(1, { message: "At least one prompt is required" });

// Test run schema
export const testRunSchema = z
    .object({
        promptId: z.coerce
            .number({ message: "promptId must be a number" })
            .int({ message: "promptId must be an integer" })
            .positive({ message: "promptId must be positive" }),
        runsPerTest: z.coerce
            .number({ message: "runsPerTest must be a number" })
            .int({ message: "runsPerTest must be an integer" })
            .min(1, { message: "runsPerTest must be at least 1" })
            .max(100, { message: "runsPerTest must be at most 100" }),
        selectedModels: z
            .array(modelSelectionSchema)
            .min(1, { message: "selectedModels must contain at least one model" })
            .optional(),
    })
    .strict();
