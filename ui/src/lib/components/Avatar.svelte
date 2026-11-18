<script>
    // Round contact avatar — initials or image, optional status dot (StatusDot) on its rim.
    import StatusDot from "./StatusDot.svelte";

    let { name = "", src = "", size = 36, status = "", statusLabel = "" } = $props();

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
    <StatusDot class="vm-avatar__status" {status} label={statusLabel} />
</span>
