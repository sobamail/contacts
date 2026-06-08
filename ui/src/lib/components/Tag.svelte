<script>
    // Removable label / filter chip.
    let { color = "", onRemove = undefined, children } = $props();
</script>

<span class="vm vm-tag">
    {#if color}
        <span class="vm-tag__dot" style="background:{color};"></span>
    {/if}
    {@render children?.()}
    {#if onRemove}
        <span
            class="vm-tag__x"
            role="button"
            tabindex="0"
            aria-label="Remove"
            onclick={onRemove}
            onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") onRemove(e);
            }}>×</span
        >
    {/if}
</span>
