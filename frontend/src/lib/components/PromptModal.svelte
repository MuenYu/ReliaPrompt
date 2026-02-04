<script lang="ts">
    import Modal from "./Modal.svelte";
    import { createPrompt, createPromptVersion } from "$lib/stores/prompts";
    import { showError } from "$lib/stores/messages";
    import * as api from "$lib/api";
    import type { Model, Prompt } from "$lib/types";

    interface Props {
        mode: "new" | "edit" | "view";
        open: boolean;
        onclose: () => void;
        promptId?: number;
        promptName?: string;
        promptVersion?: number;
    }

    let { mode, open, onclose, promptId, promptName, promptVersion }: Props = $props();

    let name = $state("");
    let content = $state("");
    let expectedSchema = $state("");
    let evaluationMode = $state<"llm" | "schema">("llm");
    let evaluationCriteria = $state("");
    let optimizerModelSelection = $state("");
    let optimizerMaxIterations = $state(0);
    let optimizerScoreThreshold = $state("");
    let availableModels = $state<Model[]>([]);
    let modelsLoaded = $state(false);
    let modelsLoading = $state(false);
    let loading = $state(false);
    let loadedPrompt = $state<Prompt | null>(null);

    const modelsByProvider = $derived(() => {
        const grouped: Record<string, Model[]> = {};
        for (const model of availableModels) {
            if (!grouped[model.provider]) {
                grouped[model.provider] = [];
            }
            grouped[model.provider].push(model);
        }
        return grouped;
    });

    // Load prompt data when opening edit/view modal
    $effect(() => {
        if (open && !modelsLoaded) {
            loadAvailableModels();
        }
        if (open && promptId && (mode === "edit" || mode === "view")) {
            loadPromptData(promptId);
        } else if (!open) {
            // Reset form when closing
            name = "";
            content = "";
            expectedSchema = "";
            evaluationMode = "llm";
            evaluationCriteria = "";
            optimizerModelSelection = "";
            optimizerMaxIterations = 0;
            optimizerScoreThreshold = "";
            loadedPrompt = null;
        }
    });

    async function loadAvailableModels() {
        modelsLoading = true;
        try {
            availableModels = await api.getModels();
            modelsLoaded = true;
        } catch {
            availableModels = [];
        } finally {
            modelsLoading = false;
        }
    }

    async function loadPromptData(id: number) {
        loading = true;
        try {
            const prompt = await api.getPrompt(id);
            loadedPrompt = prompt;
            name = prompt.name;
            content = prompt.content;
            expectedSchema = prompt.expectedSchema || "";
            evaluationMode = prompt.evaluationMode || "llm";
            evaluationCriteria = prompt.evaluationCriteria || "";
            optimizerModelSelection =
                prompt.optimizerModelProvider && prompt.optimizerModelId
                    ? `${prompt.optimizerModelProvider}::${prompt.optimizerModelId}`
                    : "";
            optimizerMaxIterations = prompt.optimizerMaxIterations ?? 0;
            optimizerScoreThreshold =
                prompt.optimizerScoreThreshold !== null && prompt.optimizerScoreThreshold !== undefined
                    ? String(prompt.optimizerScoreThreshold)
                    : "";
        } catch (error) {
            showError("Error loading prompt");
        } finally {
            loading = false;
        }
    }

    function validateSchema(schema: string): boolean {
        if (!schema.trim()) return true;
        try {
            JSON.parse(schema);
            return true;
        } catch {
            return false;
        }
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();

        if (!name.trim() || !content.trim()) {
            showError("Please fill in all required fields");
            return;
        }

        if (expectedSchema && !validateSchema(expectedSchema)) {
            showError("Output structure must be valid JSON");
            return;
        }

        const normalizedMaxIterations = Number(optimizerMaxIterations);
        if (!Number.isFinite(normalizedMaxIterations) || normalizedMaxIterations < 0) {
            showError("Optimizer max iterations must be 0 or greater");
            return;
        }
        if (!Number.isInteger(normalizedMaxIterations)) {
            showError("Optimizer max iterations must be a whole number");
            return;
        }

        const normalizedThresholdValue =
            typeof optimizerScoreThreshold === "string"
                ? optimizerScoreThreshold.trim()
                : optimizerScoreThreshold;
        const parsedThreshold =
            normalizedThresholdValue === "" ||
            normalizedThresholdValue === null ||
            normalizedThresholdValue === undefined
                ? null
                : Number(normalizedThresholdValue);
        if (parsedThreshold !== null && (!Number.isFinite(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1)) {
            showError("Optimizer threshold must be between 0 and 1");
            return;
        }

        const [selectedProvider, ...selectedModelParts] = optimizerModelSelection
            ? optimizerModelSelection.split("::")
            : [];
        const optimizerModelProvider = selectedProvider || undefined;
        const optimizerModelId = selectedModelParts.length > 0 ? selectedModelParts.join("::") : undefined;

        const resolvedName = promptName?.trim() || name.trim();
        if (!resolvedName) {
            showError("Prompt name is missing. Please reopen the editor.");
            return;
        }


        loading = true;
        try {
            if (mode === "new") {
                const result = await createPrompt({
                    name: resolvedName,
                    content: content.trim(),
                    expectedSchema: expectedSchema.trim() ? expectedSchema.trim() : null,
                    evaluationMode,
                    evaluationCriteria:
                        evaluationMode === "llm" ? evaluationCriteria.trim() || undefined : undefined,
                    optimizerModelProvider,
                    optimizerModelId,
                    optimizerMaxIterations: normalizedMaxIterations,
                    optimizerScoreThreshold: parsedThreshold,
                });
                if (result) {
                    onclose();
                }
            } else if (mode === "edit" && promptId) {
                const result = await createPromptVersion(
                    promptId,
                    resolvedName,
                    content.trim(),
                    expectedSchema.trim() ? expectedSchema.trim() : null,
                    evaluationMode,
                    evaluationMode === "llm" ? evaluationCriteria.trim() || undefined : undefined,
                    optimizerModelProvider,
                    optimizerModelId,
                    normalizedMaxIterations,
                    parsedThreshold
                );
                if (result) {
                    onclose();
                }
            }
        } finally {
            loading = false;
        }
    }

    function formatJSON(json: string): string {
        try {
            return JSON.stringify(JSON.parse(json), null, 2);
        } catch {
            return json;
        }
    }

    const title = $derived(
        mode === "new"
            ? "Create New Prompt"
            : mode === "edit"
            ? `Edit "${promptName}"`
            : promptName || "Prompt"
    );
</script>

<Modal id="new-prompt-modal" {open} {title} wide={mode === "view"} onclose={onclose}>
    {#snippet titleBadge()}
        {#if mode !== "new" && (promptVersion || loadedPrompt?.version)}
            <span class="badge badge-version">v{promptVersion || loadedPrompt?.version}</span>
        {/if}
    {/snippet}

    {#if mode === "view"}
        <div class="form-group">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Prompt Content (system)</label>
            <pre class="view-prompt-content">{loadedPrompt?.content || ""}</pre>
        </div>
        {#if loadedPrompt?.expectedSchema}
            <div class="form-group">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label>Output Structure (JSON Schema)</label>
                <pre class="view-prompt-content">{formatJSON(loadedPrompt.expectedSchema)}</pre>
            </div>
        {/if}
        <div class="form-group">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Evaluation Mode</label>
            <div class="view-prompt-content">
                {loadedPrompt?.evaluationMode === "schema" ? "Schema evaluation" : "LLM evaluation"}
            </div>
        </div>
        {#if loadedPrompt?.evaluationMode === "llm"}
            {#if loadedPrompt?.evaluationCriteria}
                <div class="form-group">
                    <!-- svelte-ignore a11y_label_has_associated_control -->
                    <label>Evaluation Criteria</label>
                    <pre class="view-prompt-content">{loadedPrompt.evaluationCriteria}</pre>
                </div>
            {/if}
            <div class="form-group">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label>Optimizer</label>
                <div class="view-prompt-content">
                    {#if loadedPrompt.optimizerMaxIterations && loadedPrompt.optimizerMaxIterations > 0}
                        {loadedPrompt.optimizerModelProvider && loadedPrompt.optimizerModelId
                            ? `${loadedPrompt.optimizerModelProvider} (${loadedPrompt.optimizerModelId})`
                            : "No optimizer model configured"}
                        <div class="muted" style="margin-top: 6px; font-size: 13px;">
                            Max iterations: {loadedPrompt.optimizerMaxIterations}
                            {#if loadedPrompt.optimizerScoreThreshold !== null && loadedPrompt.optimizerScoreThreshold !== undefined}
                                · Threshold: {loadedPrompt.optimizerScoreThreshold}
                            {/if}
                        </div>
                    {:else}
                        Disabled (max iterations set to 0)
                    {/if}
                </div>
            </div>
        {:else if loadedPrompt?.evaluationMode === "schema"}
            <div class="form-group">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label>Evaluation Schema</label>
                <div class="view-prompt-content">Defined per test case.</div>
            </div>
        {/if}
    {:else}
        <form id="new-prompt-form" onsubmit={handleSubmit}>
            {#if mode === "new"}
                <div class="form-group">
                    <label for="new-prompt-name">Prompt Name</label>
                    <input
                        type="text"
                        id="new-prompt-name"
                        bind:value={name}
                        placeholder="e.g., extract-entities"
                        required
                    />
                </div>
            {/if}
            <div class="form-group">
                    <label for="new-prompt-content">Prompt Content (system)</label>
                <textarea
                    id="new-prompt-content"
                    class="tall"
                    bind:value={content}
                    placeholder="Enter your system prompt here..."
                    required
                ></textarea>
                {#if mode === "edit"}
                    <small>Saving will create a new version of this prompt</small>
                {/if}
            </div>
            <div class="form-group">
                <label for="prompt-schema">Output Structure (JSON Schema)</label>
                <textarea
                    id="prompt-schema"
                    class="medium"
                    bind:value={expectedSchema}
                    placeholder={'{"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}}}}'}
                ></textarea>
                <small>Optional. When set, responses are generated as structured objects.</small>
            </div>
            <div class="form-group">
                <label for="evaluation-mode">Evaluation Mode</label>
                <select id="evaluation-mode" bind:value={evaluationMode}>
                    <option value="llm">LLM evaluation</option>
                    <option value="schema">Schema evaluation</option>
                </select>
                <small>
                    LLM evaluation uses criteria text. Schema evaluation uses a JSON schema per test case.
                </small>
            </div>
            {#if evaluationMode === "llm"}
                <div class="form-group">
                    <label for="evaluation-criteria">Evaluation Criteria</label>
                    <textarea
                        id="evaluation-criteria"
                        class="medium"
                        bind:value={evaluationCriteria}
                        placeholder="Describe what a good response should include..."
                    ></textarea>
                    <small>Optional. Leave empty to skip evaluation.</small>
                </div>
                <div class="form-group">
                    <label for="optimizer-model">Optimizer Model</label>
                    <select id="optimizer-model" bind:value={optimizerModelSelection} disabled={modelsLoading}>
                        <option value="">No optimizer model</option>
                        {#each Object.entries(modelsByProvider()) as [provider, models]}
                            <optgroup label={provider}>
                                {#each models as model}
                                    <option value={`${provider}::${model.id}`}>{model.name}</option>
                                {/each}
                            </optgroup>
                        {/each}
                    </select>
                    <small>Optional. Choose a model to refine outputs when optimization is enabled.</small>
                </div>
                <div class="form-group">
                    <label for="optimizer-max-iterations">Optimizer Max Iterations</label>
                    <input
                        id="optimizer-max-iterations"
                        type="number"
                        min="0"
                        step="1"
                        bind:value={optimizerMaxIterations}
                    />
                    <small>0 disables optimization. Higher values allow more refinement rounds.</small>
                </div>
                <div class="form-group">
                    <label for="optimizer-threshold">Optimizer Score Threshold</label>
                    <input
                        id="optimizer-threshold"
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        bind:value={optimizerScoreThreshold}
                        placeholder="e.g., 0.85"
                    />
                    <small>Optional. Stop optimization early when score meets or exceeds this value.</small>
                </div>
            {/if}
        </form>
    {/if}

    {#snippet footer()}
        {#if mode === "view"}
            <button type="button" class="secondary" onclick={onclose}>Close</button>
        {:else}
            <button type="button" class="secondary" onclick={onclose}>Cancel</button>
            <button type="submit" form="new-prompt-form" disabled={loading}>
                {#if loading}
                    Saving...
                {:else if mode === "new"}
                    Create Prompt
                {:else}
                    Save as New Version
                {/if}
            </button>
        {/if}
    {/snippet}
</Modal>
