<script>
    // Round contact avatar — initials or image, optional status dot.
    let { name = "", src = "", size = 36, status = "" } = $props();

    /** @type {Record<string, string>} */
    const statusColor = {
        online: "var(--green-500)",
        away: "var(--amber-400)",
        offline: "var(--ink-400)",
    };

    const initials = $derived(
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0] || "")
            .join("")
            .toUpperCase(),
    );
</script>

<span
    class="vm vm-avatar"
    style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.4)}px;"
>
    {#if src}
        <img {src} alt={name} />
    {:else}
        {initials}
    {/if}
    {#if status}
        <span
            class="vm-avatar__status"
            style="background:{statusColor[status] || 'var(--ink-400)'};"
        ></span>
    {/if}
</span>
