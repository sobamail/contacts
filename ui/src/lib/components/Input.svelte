<script>
    // Text input with optional leading icon and label. `value` is bindable.
    let {
        label = "",
        value = $bindable(""),
        placeholder = "",
        iconSrc = "",
        invalid = false,
        hint = "",
        type = "text",
        oninput = undefined,
    } = $props();

    const fieldId = $derived(
        label ? `vm-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined,
    );
</script>

<label class="vm vm-field" for={fieldId}>
    {#if label}
        <span class="vm-field__label">{label}</span>
    {/if}
    <span class="vm-input-wrap {invalid ? 'vm-input-wrap--invalid' : ''}">
        {#if iconSrc}
            <img src={iconSrc} alt="" aria-hidden="true" />
        {/if}
        <input
            id={fieldId}
            class="vm-input"
            {type}
            {placeholder}
            bind:value
            {oninput}
            aria-invalid={invalid || undefined}
        />
    </span>
    {#if hint}
        <span class="vm-field__hint {invalid ? 'vm-field__hint--err' : ''}"
            >{hint}</span
        >
    {/if}
</label>
