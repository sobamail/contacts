<script lang="ts">
    // A combobox with categorized options, drawn by the page: CEF draws a native
    // <select>'s popup flat over the fields below it, with no panel or shadow.
    type Option = { key: string; name: string; count: number };
    type Section = { label: string; options: Option[] };

    let {
        sections = [],
        value = $bindable(""),
        label = "",
        onchange = () => {},
    }: {
        sections: Section[];
        value: string;
        label: string;
        onchange?: (key: string) => void;
    } = $props();

    const panelId = `cx-picker-${Math.random().toString(36).slice(2)}`;
    let open = $state(false);
    let active = $state(-1); // index into `flat` of the option under the keyboard
    let root: HTMLElement | null = $state(null);
    let panel: HTMLElement | null = $state(null);

    const flat = $derived(sections.flatMap((s) => s.options));
    const current = $derived(flat.find((o) => o.key === value) ?? null);

    function toggle() {
        open = !open;
        active = flat.findIndex((o) => o.key === value);
    }

    function pick(key: string) {
        open = false;
        if (key === value) return;
        value = key;
        onchange(key);
    }

    function onkeydown(e: KeyboardEvent) {
        if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
            }
            return;
        }
        if (e.key === "Escape" || e.key === "Tab") {
            open = false;
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            active = Math.min(flat.length - 1, Math.max(0, active + step));
            panel
                ?.querySelectorAll("[role=option]")
                [active]?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (flat[active]) pick(flat[active].key);
        }
    }
</script>

<svelte:window
    onmousedown={(e) => {
        if (open && root && !root.contains(e.target as Node)) open = false;
    }}
/>

<div class="cx-picker" bind:this={root}>
    <button
        type="button"
        class="cx-picker__button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={panelId}
        aria-expanded={open}
        onclick={toggle}
        {onkeydown}
    >
        <span class="cx-picker__name">{current?.name ?? ""}</span>
        <span class="cx-picker__count">{current?.count ?? ""}</span>
        <span class="cx-picker__caret" aria-hidden="true"></span>
    </button>
    {#if open}
        <div
            class="cx-picker__panel"
            id={panelId}
            role="listbox"
            aria-label={label}
            bind:this={panel}
        >
            {#each sections as s (s.label)}
                {#if s.options.length > 0}
                    <div role="group" aria-label={s.label}>
                        <div class="cx-picker__head">{s.label}</div>
                        {#each s.options as o (o.key)}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                class="cx-picker__option"
                                class:cx-picker__option--active={flat[active]?.key ===
                                    o.key}
                                role="option"
                                tabindex="-1"
                                aria-selected={o.key === value}
                                onclick={() => pick(o.key)}
                                onmouseenter={() =>
                                    (active = flat.findIndex((f) => f.key === o.key))}
                            >
                                <span class="cx-picker__name">{o.name}</span>
                                <span class="cx-picker__count">{o.count}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
