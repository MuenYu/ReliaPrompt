# Optimizer Feature (LLM Evaluation Mode)

## Purpose

Provide an optional, iterative refinement loop that improves model outputs during evaluation runs in **LLM evaluation mode**. The optimizer uses a separate model selected by the user, and it consumes the **latest evaluation result** plus the **latest output** to produce a revised output that is then re-evaluated.

This feature is designed to:

- Improve output quality when the initial response does not meet evaluation criteria.
- Make evaluation runs more informative by showing whether targeted feedback can fix outputs.
- Remain fully optional and explicitly controlled by a user-defined upper limit.

## Scope

- **Enabled only when evaluation mode is `llm`.**
- **Disabled when evaluation mode is `schema`.**
- **Disabled when optimizer upper limit is `0`.**
- **Changes span frontend and backend** to configure, run, persist, and display optimization rounds.

## User Controls

### Optimizer Model Selection

Users can select a specific model to act as the optimizer. This model is distinct from:

- The model under test (the one producing the initial output).
- The evaluation model (the one scoring output against criteria).

### Optimizer Upper Limit

Users set a maximum number of optimization iterations for each output. This is a hard cap.

- **`0`**: Optimization is disabled.
- **`N > 0`**: Up to `N` optimizer iterations may run.

### Optimizer Threshold (Prompt-level)

Users can define a **score threshold** on the prompt. If the evaluation model returns a score **greater than or equal to the threshold**, optimization stops early.

- The threshold is evaluated after each evaluation step.
- If the threshold is reached on the initial evaluation, no optimizer iteration runs.

## Inputs to the Optimizer

Each optimizer invocation receives:

- **Latest output**: the most recent output produced by the model under test or by a prior optimizer iteration.
- **Latest evaluation result**: the most recent evaluation feedback, including score and reason.

These inputs are intended to provide concrete, actionable feedback for refinement.

## Behavior Overview

The optimizer adds a feedback loop to the standard LLM evaluation flow:

1. **Generate output** with the model under test.
2. **Evaluate output** using the evaluation model and criteria.
3. If optimization is enabled and iteration limit not reached:
    - **Invoke optimizer** with the latest output and latest evaluation result.
    - **Receive optimized output** from optimizer.
4. **Re-evaluate** the optimized output using the evaluation model.
5. **Repeat** steps 3–4 until one of the following happens:
    - The optimization limit is reached.
    - Evaluation score reaches or exceeds the optimizer threshold.
    - Evaluation score is already satisfactory (for example, perfect score).
    - Optimization is disabled or not applicable.

All rounds produce their own evaluation and optimization artifacts, and each round is preserved for later review.

## Evaluation Mode Constraints

- **LLM mode only**: The optimizer relies on evaluation feedback from the LLM grading process. Schema evaluation does not provide the same qualitative feedback, so the optimizer never runs in schema mode.
- If **evaluation criteria are missing or empty**, evaluation is skipped; therefore optimization does not run.

## Iteration Semantics

The optimizer limit applies **per output instance** (e.g., each test case run).

- Example: If the limit is 2, a single output can be optimized at most twice.
- The loop always uses the **latest output** and the **latest evaluation result**.
- Each round produces **one evaluation result**, and every optimizer call produces **one optimized output**.
- The sequence is persisted in order, so users can inspect how outputs and scores evolve across rounds.

## Storage and Visibility

- Every round (initial evaluation and each optimizer iteration) is saved.
- Test detail views show the full sequence so users can compare:
    - Initial output and evaluation
    - Each optimized output
    - Re-evaluation results after each optimization step

## Expected Outcomes

- **Best effort refinement**: The optimizer should attempt to resolve issues described in the evaluation reason.
- **No guarantee of improvement**: A later evaluation may remain unchanged or worsen.
- **Clear termination**: Optimization always stops after the specified limit or when not applicable.

## Edge Cases and Fallbacks

- **Optimizer disabled (limit = 0)**: The system behaves as today, with a single evaluation pass.
- **Optimizer model not configured**: Optimization is skipped and the original evaluation result stands.
- **Evaluator unavailable**: If evaluation cannot run, optimization does not run.
- **Optimizer produces invalid output**: The next evaluation will score it accordingly; no special handling is implied beyond the evaluation result.

## User Experience Summary

- Users can **toggle optimization** by setting the limit to `0` (off) or `N > 0` (on).
- Users can **choose the optimizer model** independently from the models under test.
- Results show the **full round history** in the test detail view, including the final evaluation after all optimization iterations complete.

## Example Flow (Single Test Case)

1. Model under test produces output A.
2. Evaluation model scores output A (e.g., score 0.4, reason: missing a required field).
3. Optimizer receives output A and the evaluation result, returns output B.
4. Evaluation model scores output B.
5. If the limit allows, optimizer receives output B and the latest evaluation result, returns output C.
6. Final evaluation is recorded after the last iteration.
