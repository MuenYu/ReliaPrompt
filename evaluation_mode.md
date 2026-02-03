# Evaluation Modes

This document describes the intended evaluation logic for the two evaluation modes now stored and surfaced in the UI. It reflects the current storage and UI work only; evaluation execution will be implemented in a future PR.

## Overview

Each prompt stores an `evaluationMode` and, for LLM evaluation, an `evaluationCriteria` string. When `evaluationMode` is `schema`, each test case can store its own `evaluationSchema` JSON schema. This allows different test cases to be validated against different JSON schemas. Both `evaluationCriteria` and `evaluationSchema` are optional; if they are empty, evaluation should be skipped.

Storage summary:

- Prompt: `evaluationMode` ("llm" | "schema")
- Prompt: `evaluationCriteria` (string; optional)
- Test case: `evaluationSchema` (string JSON; optional; used when `evaluationMode` is "schema")

## Mode 1: LLM Evaluation

### Purpose

Use a grading LLM to judge the output against human-readable criteria, when criteria is provided.

### Inputs

- Prompt content (system prompt)
- Test case input (user message)
- Model output (actual response)
- Prompt `evaluationCriteria` (text; optional)

### Expected logic

1. Generate the model output for each test case.
2. If `evaluationCriteria` is empty, skip evaluation and mark the run as "not evaluated" (score handling to be defined in the evaluation PR).
3. If criteria is present, send an evaluation request to a grading LLM using:
    - The original prompt and input for context.
    - The model output to judge.
    - The `evaluationCriteria` text to define what "good" means.
4. The grader returns a decision and score (format to be defined in the evaluation PR).
5. Store the score and any evaluation artifacts in test results.

### Notes

- `evaluationCriteria` is optional; empty means no evaluation is performed.

## Mode 2: Schema Evaluation

### Purpose

Validate each test case output against a JSON schema, per test case, when a schema is provided.

### Inputs

- Prompt content (system prompt)
- Test case input (user message)
- Model output (actual response)
- Test case `evaluationSchema` (JSON schema string; optional)

### Expected logic

1. Generate the model output for each test case.
2. If `evaluationSchema` is empty, skip evaluation and mark the run as "not evaluated" (score handling to be defined in the evaluation PR).
3. If schema is present, parse the model output as JSON (strict or tolerant parsing to be decided).
4. Validate the parsed output against the test case `evaluationSchema`.
5. If valid, mark the run as correct and compute score = 1. If invalid, mark incorrect and score = 0.
6. Store validation results and any error messages in test results.

### Notes

- `evaluationSchema` is optional; empty means no evaluation is performed.
- The prompt-level `expectedSchema` (structured output schema) remains independent and can still be used to shape model output, but it is not the evaluation schema.

## UI Behavior Summary

- Prompt creation/editing shows an evaluation mode selector.
- If mode is "llm", the criteria text area is shown and optional.
- If mode is "schema", the criteria field is hidden and each test case exposes an "Evaluation Schema" JSON field.

## Data Flow Summary

- Prompt creation/editing: `evaluationMode`, `evaluationCriteria` stored on the prompt.
- Test case create/update: `evaluationSchema` stored per test case.
- Export/import:
    - Prompts include `evaluation_mode` and `evaluation_criteria`.
    - Test cases include `evaluation_schema`.
