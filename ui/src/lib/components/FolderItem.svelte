<script>
    // Sidebar group row — folder icon, name, optional count badge.
    import Badge from "./Badge.svelte";
    let {
        iconSrc = "",
        name = "",
        count = 0,
        active = false,
        onclick = undefined,
    } = $props();
</script>

<button
    class="vm vm-folder {active ? 'vm-folder--active' : ''}"
    aria-current={active || undefined}
    {onclick}
>
    {#if iconSrc}
        <img src={iconSrc} alt="" aria-hidden="true" />
    {/if}
    <span class="vm-folder__name">{name}</span>
    {#if count > 0}
        <Badge variant={active ? "neutral" : "primary"}
            >{count > 99 ? "99+" : count}</Badge
        >
    {/if}
</button>
