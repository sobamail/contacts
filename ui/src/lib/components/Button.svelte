<script>
    // Sobamail primary button.
    /**
     * @type {{
     *   variant?: string, size?: string, block?: boolean, iconSrc?: string,
     *   disabled?: boolean, type?: "button" | "submit" | "reset",
     *   onclick?: (e: MouseEvent) => void, children?: import('svelte').Snippet
     * }}
     */
    let {
        variant = "primary",
        size = "md",
        block = false,
        iconSrc = "",
        disabled = false,
        type = "button",
        onclick = undefined,
        children,
    } = $props();

    const cls = $derived(
        [
            "vm vm-btn",
            variant !== "primary" && `vm-btn--${variant}`,
            size !== "md" && `vm-btn--${size}`,
            block && "vm-btn--block",
        ]
            .filter(Boolean)
            .join(" "),
    );
</script>

<button {type} class={cls} {disabled} {onclick}>
    {#if iconSrc}
        <img class="vm-btn__icon" src={iconSrc} alt="" aria-hidden="true" />
    {/if}
    {@render children?.()}
</button>
