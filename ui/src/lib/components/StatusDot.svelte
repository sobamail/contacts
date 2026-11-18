<script>
    // An online status dot: green online, red offline, grey while the status is unknown -- the
    // --presence-* colours of ../presence.css, which amp-mgui generates so that every Sobamail
    // surface shows the same dots. `class` places it.
    import "../presence.css";

    let { status = "", label = "", class: cls = "vm-statusdot" } = $props();

    /** @type {Record<string, string>} */
    const statusColor = {
        online: "var(--presence-online)",
        away: "var(--amber-400)",
        offline: "var(--presence-offline)",
        unknown: "var(--presence-unknown)",
    };
</script>

{#if status}
    <span
        class={cls}
        title={label || status}
        style="background:{statusColor[status] || 'var(--ink-400)'};"
    ></span>
{/if}
