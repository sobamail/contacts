<script>
    // Icon-only (optionally labelled) toolbar button. Pass a brand SVG via `src`.
    let {
        src = "",
        label = "",
        showLabel = false,
        size = 28,
        pressed = false,
        disabled = false,
        onclick = undefined,
    } = $props();
</script>

<button
    type="button"
    class="vm vm-iconbtn"
    aria-pressed={pressed || undefined}
    aria-label={label}
    title={label}
    {disabled}
    {onclick}
>
    <img {src} width={size} height={size} alt="" aria-hidden="true" />
    {#if showLabel && label}
        <span class="vm-iconbtn__label">{label}</span>
    {/if}
</button>
