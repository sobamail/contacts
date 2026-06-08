<script>
    // Small count / status badge.
    let { variant = "primary", children } = $props();
    const cls = $derived(
        ["vm vm-badge", variant !== "primary" && `vm-badge--${variant}`]
            .filter(Boolean)
            .join(" "),
    );
</script>

<span class={cls}>{@render children?.()}</span>
