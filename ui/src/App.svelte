<script lang="ts">
    import { onMount } from "svelte";
    import { Person } from "$module/contacts/v1";
    import {
        read_people,
        read_person,
        put_person,
        delete_person,
        send_vcard,
        TAG_REPLIED,
    } from "$lib/model";
    import {
        parse_fragment,
        split_name,
        same_name,
        holds_email,
    } from "$lib/fragment";
    import {
        LABEL_OPTIONS,
        label_text,
        labels_map,
        labels_of,
    } from "$lib/labels";
    import {
        download,
        parse_vcards,
        vcard,
        vcard_filename,
        type ImportedPerson,
    } from "$lib/vcard";
    import { email_ok, is_email } from "$lib/email";
    import { merge_people } from "$lib/merge";

    import Avatar from "./lib/components/Avatar.svelte";
    import Button from "./lib/components/Button.svelte";
    import IconButton from "./lib/components/IconButton.svelte";
    import FolderItem from "./lib/components/FolderItem.svelte";
    import Tag from "./lib/components/Tag.svelte";
    import Input from "./lib/components/Input.svelte";

    const icTb = (n: string) => `/ds/assets/icons/toolbar/${n}.svg`;
    const icFd = (n: string) => `/ds/assets/icons/folders/${n}.svg`;
    const appIcon = "/ds/assets/icons/app/icon-16.svg";

    // ---- App state ----
    let people: Person[] = $state([]);
    let selectedUuid: string | null = $state(null);
    // The selected person as last fetched, for when the loaded pages don't
    // hold it (a big address book, a contact saved just now).
    let selectedCard = $state<Person | null>(null);
    let query = $state(""); // server-side search filter
    let group = $state("all"); // active sidebar tag (client-side filter)
    let mode = $state("view"); // "view" | "edit" | "new"
    let form: Person | null = $state(null);
    // The person as the edit form loaded it, sent along on save so that only
    // the user's changes are applied (null for a new person).
    let formBase: Person | null = null;
    let tagsText = $state(""); // free-text buffer for the tags field
    // labels of form.emails / form.phones, index by index (see lib/labels)
    let emailLabels = $state<string[]>([]);
    let phoneLabels = $state<string[]>([]);

    // ---- Pagination / infinite scroll (server-driven) ----
    let pageSize = $state(500);
    let offset = $state(0);
    let lastCount = $state(0);
    let isAppending = $state(false);
    let isLoading = $state(false);
    let reload = $state(0); // bump to force a fresh fetch after writes

    let sentinel: HTMLElement | null = $state(null);
    let observer: IntersectionObserver | null = null;

    const isForm = $derived(mode === "edit" || mode === "new");

    // A contact needs at least one non-blank field; the backend refuses to
    // create an empty one as well.
    const formEmpty = $derived.by(() => {
        if (!form) return true;
        const fields = [
            form.firstName,
            form.lastName,
            form.jobTitle,
            form.company,
            form.address,
            form.notes,
            tagsText,
            ...(form.emails ?? []),
            ...(form.phones ?? []),
        ];
        return fields.every((f) => !(f ?? "").trim());
    });

    // An email row that isn't blank and doesn't look like an address blocks the
    // save (lib/email: a check for typos, not for deliverability).
    const formBadEmails = $derived.by(() =>
        (form?.emails ?? []).some((e: string) => !email_ok(e)),
    );

    // ---- Data fetch: server search + pagination -------------------------
    // The backend implements `filter` (search) and limit/offset; tag
    // filtering is applied on the client below (see `filtered`).
    // Plain variables on purpose: changing them must not re-run the effect.
    let fetchSeq = 0; // only the newest request may apply its reply
    let lastQuery = "";

    $effect(() => {
        const _r = reload;
        const q = query; // track: re-fetch when the search changes
        const o = offset; // track: append when scrolling
        const seq = ++fetchSeq;
        isLoading = true;

        // Wait for a pause in typing; paging and refreshes go out at once.
        // Re-running the effect clears a pending timer.
        const typing = q !== lastQuery;
        lastQuery = q;
        const timer = setTimeout(
            () => {
                const append = isAppending;
                read_people(q, [], pageSize, o)
                    .then((r) => {
                        if (seq !== fetchSeq) return;
                        lastCount = r.length;
                        people = append ? [...people, ...r] : r;
                    })
                    .catch((err) => {
                        if (seq !== fetchSeq) return;
                        console.error("read_people:", err);
                        if (!append) people = [];
                    })
                    .finally(() => {
                        if (seq !== fetchSeq) return;
                        isLoading = false;
                        isAppending = false;
                    });
            },
            typing ? 250 : 0,
        );
        return () => clearTimeout(timer);
    });

    onMount(() => {
        if (typeof IntersectionObserver === "undefined") return;
        observer = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (
                        e.isIntersecting &&
                        !isLoading &&
                        lastCount >= pageSize
                    ) {
                        isAppending = true;
                        offset = offset + pageSize;
                    }
                }
            },
            { root: null, rootMargin: "800px", threshold: 0.1 },
        );
        if (sentinel) observer.observe(sentinel);
        return () => observer?.disconnect();
    });

    $effect(() => {
        if (sentinel && observer) observer.observe(sentinel);
    });

    // A link that composes a message to `address`: in Sobamail the host opens
    // its own composer for an app page's mailto: links.
    const mailto = (address: string) =>
        "mailto:" + encodeURIComponent(address.trim()).replace("%40", "@");

    // ---- Derived views ---------------------------------------------------
    // a person without a name goes by its first email (owner, 2026-10-19)
    const fullName = (p: Person) =>
        `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
        (p.emails ?? [])[0] ||
        "(no name)";

    // Sidebar groups are derived from the tags present in the loaded set.
    const groupRows = $derived.by(() => {
        const counts = new Map<string, number>();
        for (const p of people) {
            for (const t of p.tags ?? []) {
                counts.set(t, (counts.get(t) ?? 0) + 1);
            }
        }
        const tagRows = Array.from(counts.keys())
            .sort((a, b) => a.localeCompare(b))
            .map((t) => ({
                key: t,
                name: t,
                iconSrc: icFd("folder"),
                count: counts.get(t) ?? 0,
                active: t === group,
            }));
        return [
            {
                key: "all",
                name: "All contacts",
                iconSrc: icFd("folder-user"),
                count: people.length,
                active: group === "all",
            },
            ...tagRows,
        ];
    });

    // The server pages people in display order (by last name, then first
    // name, nameless last), so the loaded pages are a prefix of the full list
    // and are kept as they come.
    const filtered = $derived(
        group === "all"
            ? people
            : people.filter((p) => (p.tags ?? []).includes(group)),
    );

    // Group the visible rows into alphabetical sections by last name.
    const sections = $derived.by(() => {
        const map: Record<string, Person[]> = {};
        const order: string[] = [];
        for (const p of filtered) {
            const basis = (p.lastName || p.firstName || "#").trim();
            const k = (basis.charAt(0) || "#").toUpperCase();
            if (!map[k]) {
                map[k] = [];
                order.push(k);
            }
            map[k].push(p);
        }
        // "#", the people without a name, last, as the server orders them
        order.sort(
            (a, b) =>
                Number(a === "#") - Number(b === "#") || a.localeCompare(b),
        );
        return order.map((k) => ({ label: k, rows: map[k] }));
    });

    const sel = $derived(
        people.find((c) => c.uuid === selectedUuid) ??
            (selectedCard?.uuid === selectedUuid ? selectedCard : null),
    );

    const groupTitle = $derived(group === "all" ? "All contacts" : group);
    const countLabel = $derived(
        `${filtered.length} ${filtered.length === 1 ? "contact" : "contacts"}`,
    );
    const noSel = $derived(!sel || isForm);

    // ---- Actions ---------------------------------------------------------
    function select(uuid: string) {
        selectedUuid = uuid;
        mode = "view";
    }
    function pickGroup(key: string) {
        group = key;
        mode = "view";
    }

    // `init` and `patch` pre-fill the form, as a launch fragment does.
    function startNew(init: Partial<Person> = {}) {
        // spread into a PLAIN object — Svelte 5 $state only deep-proxies plain
        // objects/arrays, not class instances, so array edits stay reactive.
        form = { ...new Person(init) };
        formBase = null;
        loadFormLists(form);
        selectedUuid = null;
        mode = "new";
    }
    async function startEdit(patch: Partial<Person> = {}) {
        if (!selectedUuid) return;
        // pull the freshest copy from the server before editing
        const fresh = await read_person(selectedUuid);
        const loaded = new Person(fresh ?? sel ?? {});
        // the base is taken before the patch, so a patched field counts as changed
        formBase = {
            ...loaded,
            emails: [...loaded.emails],
            phones: [...loaded.phones],
            tags: [...loaded.tags],
            labels: $state.snapshot(loaded.labels ?? {}),
        };
        form = { ...loaded, ...patch };
        loadFormLists(form);
        mode = "edit";
    }

    // the form's free-text and per-row buffers, from a person
    function loadFormLists(p: Person) {
        tagsText = (p.tags ?? []).join(", ");
        emailLabels = labels_of(p.emails ?? [], p.labels?.emails);
        phoneLabels = labels_of(p.phones ?? [], p.labels?.phones);
    }

    // ---- Launch fragments (see lib/fragment) -----------------------------
    // person/new opens an empty new entry. person/show?email=…&name=… shows
    // the card holding the email; a card under another name opens as an edit
    // with the new name; no card opens a pre-filled new entry.
    let fragmentSeq = 0; // a newer fragment wins over a lookup in flight

    async function openFragment() {
        const f = parse_fragment(location.hash);
        if (f === null) return; // the app's root

        // Handled or invalid, the fragment goes: a reload doesn't apply it
        // again, and the same launch again changes the hash, so it is seen.
        history.replaceState(null, "", location.pathname + location.search);
        if (f === "invalid") return;

        const seq = ++fragmentSeq;
        if (f.action === "new") {
            startNew();
            return;
        }

        let matches: Person[];
        try {
            // the search narrows by substring; the exact match is ours
            matches = (await read_people(f.email, [], pageSize, 0)).filter(
                (p) => holds_email(p.emails ?? [], f.email),
            );
        } catch (err) {
            console.error("person/show lookup:", err);
            return;
        }
        if (seq !== fragmentSeq) return;

        const [firstName, lastName] = split_name(f.name);
        const named = (p: Person) =>
            same_name(p.firstName ?? "", p.lastName ?? "", f.name);
        // several cards can hold one address; prefer one under this name
        const card = matches.find(named) ?? matches[0];
        if (!card) {
            startNew({ firstName, lastName, emails: [f.email] });
            return;
        }

        selectedUuid = card.uuid;
        selectedCard = card;
        mode = "view";
        if (f.name && !named(card)) {
            await startEdit({ firstName, lastName });
        }
    }

    onMount(() => {
        openFragment();
    });
    function cancel() {
        form = null;
        mode = "view";
    }

    async function save() {
        if (!form || formEmpty || formBadEmails) return;
        // commit the free-text tags buffer into the model
        form.tags = tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        // an edited contact is the user's: the collect's tag goes, so Sobamail stops renaming
        // it after the mail it sends (the base still holds the tag, so the backend removes it)
        if (formBase?.tags?.includes(TAG_REPLIED)) {
            form.tags = form.tags.filter((t) => t !== TAG_REPLIED);
        }
        form.labels = {
            emails: labels_map(form.emails, emailLabels),
            phones: labels_map(form.phones, phoneLabels),
        };
        try {
            const resp = await put_person(form, formBase);
            const uuid = resp?.uuid ?? form.uuid;
            form = null;
            mode = "view";
            offset = 0;
            isAppending = false;
            reload += 1; // refetch list
            if (uuid) {
                selectedUuid = uuid;
                selectedCard = await read_person(uuid);
            }
        } catch (err) {
            alert(String(err));
        }
    }

    // Delete is gated by an in-app modal (below) rather than the native
    // confirm(), which some embedded webviews suppress.
    let confirmingDelete = $state(false);

    function remove() {
        if (!sel) return;
        confirmingDelete = true;
    }

    async function confirmDelete() {
        if (!sel) return;
        const uuid = sel.uuid;
        confirmingDelete = false;
        try {
            await delete_person(uuid);
            selectedUuid = null;
            mode = "view";
            offset = 0;
            isAppending = false;
            reload += 1; // refetch list
        } catch (err) {
            alert("Failed to delete contact: " + String(err));
        }
    }

    // ---- Merge (lib/merge) -------------------------------------------------
    // The user deduplicates the list: any contact can be merged into the shown
    // one, which takes its details; the merged one is then deleted. The shown
    // contact is written first, so a failure leaves a duplicate, never a loss.
    let merging = $state(false); // the dialog is open
    let mergeQuery = $state("");
    let mergeCandidates = $state<Person[]>([]);
    let mergeFrom = $state<Person | null>(null); // picked, to be confirmed
    let mergeRunning = $state(false);
    let mergeSeq = 0; // a newer search wins over one in flight

    function startMerge() {
        if (!sel) return;
        mergeQuery = "";
        mergeFrom = null;
        mergeCandidates = [];
        merging = true;
        findMergeCandidates();
    }

    async function findMergeCandidates() {
        const seq = ++mergeSeq;
        const into = selectedUuid;
        try {
            const found = await read_people(mergeQuery.trim(), [], pageSize, 0);
            if (seq !== mergeSeq) return;
            mergeCandidates = found.filter((p) => p.uuid !== into);
        } catch (err) {
            console.error("merge search:", err);
        }
    }

    async function confirmMerge() {
        if (!sel || !mergeFrom) return;
        mergeRunning = true;
        try {
            // both as stored now; the shown one's copy is the base, so only
            // what the merge adds is applied
            const into = await read_person(sel.uuid);
            const from = await read_person(mergeFrom.uuid);
            if (!into || !from) throw new Error("a contact to merge is gone");

            const base = {
                ...into,
                emails: [...into.emails],
                phones: [...into.phones],
                tags: [...into.tags],
            };
            await put_person({ ...merge_people(into, from) }, base);
            await delete_person(from.uuid);

            merging = false;
            mergeFrom = null;
            offset = 0;
            isAppending = false;
            reload += 1; // refetch list
            selectedUuid = into.uuid;
            selectedCard = await read_person(into.uuid);
        } catch (err) {
            alert("Failed to merge contacts: " + String(err));
        } finally {
            mergeRunning = false;
        }
    }

    // ---- vCard export (lib/vcard) -----------------------------------------
    // The card is written here; the backend reads the people, and mails the
    // card it is given.
    const EXPORT_ALL = 1_000_000; // a GetPeople limit that takes everyone
    let exporting = $state(false);
    let exportAll = $state(false); // false: the selected contact
    let sendTo = $state(""); // addresses, separated by commas or blanks
    let exportStatus = $state("");

    const recipients = $derived(sendTo.split(/[\s,;]+/).filter(Boolean));
    const recipientsOk = $derived(
        recipients.length > 0 && recipients.every(is_email),
    );

    function startExport() {
        exportAll = !sel;
        exportStatus = "";
        exporting = true;
    }

    async function exportList(): Promise<Person[]> {
        return exportAll
            ? await read_people("", [], EXPORT_ALL, 0)
            : [(await read_person(sel!.uuid)) ?? sel!];
    }

    async function exportVCard() {
        try {
            const list = await exportList();
            download(vcard(list), vcard_filename(list), "text/vcard;charset=utf-8");
            exporting = false;
        } catch (err) {
            alert("Failed to export: " + String(err));
        }
    }

    async function sendVCard() {
        if (!recipientsOk) return;
        exportStatus = "Sending…";
        try {
            const list = await exportList();
            const one = list.length === 1;
            await send_vcard(
                recipients,
                vcard_filename(list),
                vcard(list),
                one ? `Contact: ${fullName(list[0])}` : `Contacts (${list.length})`,
                one
                    ? "The contact card is attached."
                    : `${list.length} contact cards are attached.`,
            );
            exportStatus = `Sent to ${recipients.join(", ")}.`;
        } catch (err) {
            exportStatus = "Failed to send: " + String(err);
        }
    }

    // ---- vCard import (lib/vcard) -----------------------------------------
    // The file is parsed here; once the user has confirmed the cards, each one
    // becomes a PutPerson, one after the other.
    type ImportRow = { person: ImportedPerson; chosen: boolean; known: boolean };
    let importInput: HTMLInputElement | null = $state(null);
    let importing = $state(false); // the dialog is open
    let importRows = $state<ImportRow[]>([]);
    let importSkipped = $state(0);
    let importTotal = $state(0); // 0 until the import starts
    let importDone = $state(0);
    let importRunning = $state(false);
    let importStatus = $state("");
    let importStop = false;

    const importChosen = $derived(importRows.filter((r) => r.chosen).length);
    const importStarted = $derived(importTotal > 0);

    const import_name = (p: ImportedPerson) =>
        `${p.firstName} ${p.lastName}`.trim() ||
        p.company ||
        p.emails[0] ||
        p.phones[0] ||
        "(no name)";

    async function onImportFile(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = ""; // so that choosing the same file again is a change too
        if (!file) return;
        try {
            const { people: cards, skipped } = parse_vcards(await file.text());
            // cards with an address already in the book start unchosen
            const known = new Set(
                (await read_people("", [], EXPORT_ALL, 0)).flatMap((p) =>
                    (p.emails ?? []).map((a) => a.trim().toLowerCase()),
                ),
            );
            importRows = cards.map((person) => {
                const isKnown = person.emails.some((a) => known.has(a.toLowerCase()));
                return { person, chosen: !isKnown, known: isKnown };
            });
            importSkipped = skipped;
            importTotal = 0;
            importDone = 0;
            importStatus = "";
            importing = true;
        } catch (err) {
            alert("Failed to read the file: " + String(err));
        }
    }

    function chooseAll(chosen: boolean) {
        for (const r of importRows) r.chosen = chosen;
    }

    async function runImport() {
        const chosen = importRows.filter((r) => r.chosen).map((r) => r.person);
        importTotal = chosen.length;
        importDone = 0;
        importRunning = true;
        importStop = false;
        let failed = 0;
        for (const p of chosen) {
            if (importStop) break;
            try {
                await put_person(new Person({ ...p }));
            } catch (err) {
                failed++;
                console.error("import:", err);
            }
            importDone++;
        }
        importRunning = false;
        importStatus =
            `Imported ${importDone - failed} of ${importTotal}` +
            (failed ? `, ${failed} failed` : "") +
            (importStop ? ", stopped" : "") +
            ".";
        offset = 0;
        isAppending = false;
        reload += 1;
    }

    // ---- Form field helpers (emails / phones are string[]) ---------------
    // Each list's labels sit in an array parallel to it (see lib/labels).
    const without = <T,>(a: T[], i: number) => a.filter((_, idx) => idx !== i);
    function addEmail() {
        if (form) form.emails = [...(form.emails ?? []), ""];
        emailLabels = [...emailLabels, ""];
    }
    function removeEmail(i: number) {
        if (form) form.emails = without(form.emails, i);
        emailLabels = without(emailLabels, i);
    }
    function addPhone() {
        if (form) form.phones = [...(form.phones ?? []), ""];
        phoneLabels = [...phoneLabels, ""];
    }
    function removePhone(i: number) {
        if (form) form.phones = without(form.phones, i);
        phoneLabels = without(phoneLabels, i);
    }
</script>

<div class="cx-app">
    <!-- Toolbar -->
    <div class="cx-toolbar">
        <IconButton
            src={icTb("add")}
            label="New contact"
            showLabel
            onclick={() => startNew()}
        />
        <span class="cx-sep"></span>
        <IconButton
            src={icTb("edit-as-new")}
            label="Edit"
            showLabel
            disabled={noSel}
            onclick={() => startEdit()}
        />
        <IconButton
            src={icTb("del")}
            label="Delete"
            showLabel
            disabled={noSel}
            onclick={remove}
        />
        <IconButton
            src={icTb("new")}
            label="Import"
            showLabel
            disabled={isForm}
            onclick={() => importInput?.click()}
        />
        <IconButton
            src={icTb("forward")}
            label="Export"
            showLabel
            disabled={isForm}
            onclick={startExport}
        />
        <input
            type="file"
            accept=".vcf,.vcard,text/vcard,text/x-vcard"
            style="display:none;"
            aria-label="vCard file to import"
            bind:this={importInput}
            onchange={onImportFile}
        />
        <span class="cx-sep"></span>
        <IconButton
            src={icTb("sync")}
            label="Refresh"
            showLabel
            onclick={() => {
                offset = 0;
                isAppending = false;
                reload += 1;
            }}
        />
        <!-- we have no options to show
        <IconButton src={icTb("options")} label="Options" showLabel /> 
        -->
        <div style="flex:1;"></div>
    </div>

    <!-- Body -->
    <div class="cx-body">
        <!-- Sidebar: groups (derived from tags) -->
        <div class="cx-sidebar">
            <div class="cx-account">
                <Avatar name="Sobamail Contacts" size={34} />
                <div style="min-width:0;">
                    <div style="font-size:var(--text-base);">Contacts</div>
                    <div
                        style="font-size:var(--text-xs);color:var(--text-muted);"
                    >
                        sobamail.com
                    </div>
                </div>
            </div>
            <div class="cx-grouplist">
                <div class="cx-caps">Groups</div>
                {#each groupRows as g (g.key)}
                    <FolderItem
                        iconSrc={g.iconSrc}
                        name={g.name}
                        count={g.count}
                        active={g.active}
                        onclick={() => pickGroup(g.key)}
                    />
                {/each}
            </div>
            <div class="cx-status">
                <span class="cx-dot" style="background:var(--green-500);"
                ></span>
                {isLoading ? "Syncing…" : `${people.length} loaded`}
            </div>
        </div>

        <!-- Contact list -->
        <div class="cx-listpane">
            <div class="cx-listhead">
                <div class="cx-listtitle">
                    <span style="font-size:var(--text-lg);">{groupTitle}</span>
                    <span
                        style="font-size:var(--text-xs);color:var(--text-muted);"
                        >{countLabel}</span
                    >
                </div>
                <div class="cx-search">
                    <img
                        src={icTb("search")}
                        width="16"
                        height="16"
                        alt=""
                        style="opacity:.8;"
                    />
                    <input
                        bind:value={query}
                        placeholder="Search contacts"
                        oninput={() => {
                            offset = 0;
                            isAppending = false;
                        }}
                    />
                </div>
            </div>
            <div class="cx-list">
                {#if filtered.length > 0}
                    {#each sections as s (s.label)}
                        <div class="cx-sectionhead">{s.label}</div>
                        {#each s.rows as c (c.uuid)}
                            <button
                                class="cx-row {c.uuid === selectedUuid &&
                                !isForm
                                    ? 'cx-row--selected'
                                    : ''}"
                                onclick={() => select(c.uuid)}
                            >
                                <Avatar name={fullName(c)} size={40} />
                                <div style="flex:1;min-width:0;">
                                    <div class="cx-row__name">
                                        {fullName(c)}
                                    </div>
                                    <div class="cx-row__sub">
                                        {c.jobTitle}{c.company
                                            ? `${c.jobTitle ? " · " : ""}${c.company}`
                                            : ""}
                                    </div>
                                </div>
                            </button>
                        {/each}
                    {/each}
                {:else if !isLoading}
                    <div class="cx-empty">
                        <div
                            style="font-size:var(--text-md);color:var(--text-secondary);"
                        >
                            No contacts found
                        </div>
                        <div style="font-size:var(--text-sm);margin-top:6px;">
                            Try a different search or group.
                        </div>
                    </div>
                {/if}

                {#if isLoading}
                    <div class="cx-loading">Loading…</div>
                {/if}

                <!-- infinite-scroll sentinel -->
                {#if lastCount >= pageSize}
                    <div
                        class="cx-sentinel"
                        bind:this={sentinel}
                        aria-hidden="true"
                    ></div>
                {/if}
            </div>
        </div>

        <!-- Detail / form pane -->
        <div class="cx-detail">
            {#if !isForm}
                {#if sel}
                    <div class="cx-detailhead">
                        <Avatar name={fullName(sel)} size={72} />
                        <div style="flex:1;min-width:0;">
                            <div
                                style="font-size:var(--text-2xl);line-height:1.15;"
                            >
                                {fullName(sel)}
                            </div>
                            <div
                                style="font-size:var(--text-md);color:var(--text-secondary);margin-top:3px;"
                            >
                                {sel.jobTitle}{sel.company
                                    ? `${sel.jobTitle ? " · " : ""}${sel.company}`
                                    : ""}
                            </div>
                            {#if sel.tags?.length}
                                <div
                                    style="display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap;"
                                >
                                    {#each sel.tags as t}
                                        <Tag color="var(--blue-500)">{t}</Tag>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>

                    <div class="cx-detailbody">
                        <div class="cx-infocard">
                            <div class="cx-infocard__head">Contact details</div>
                            <div class="cx-inforow">
                                <div class="cx-inforow__label">Email</div>
                                <div
                                    class="cx-inforow__value"
                                    style="color:var(--text-link);font-family:var(--font-mono);"
                                >
                                    {#if sel.emails?.length}
                                        <div class="stack">
                                            {#each sel.emails as e}<span
                                                    >{#if sel.labels?.emails?.[e]}<span
                                                            class="cx-label"
                                                            >{label_text(
                                                                sel.labels.emails[e],
                                                            )}</span
                                                        >{/if}<a
                                                        class="cx-maillink"
                                                        href={mailto(e)}>{e}</a
                                                    ></span
                                                >{/each}
                                        </div>
                                    {:else}—{/if}
                                </div>
                            </div>
                            <div class="cx-inforow">
                                <div class="cx-inforow__label">Phone</div>
                                <div class="cx-inforow__value">
                                    {#if sel.phones?.length}
                                        <div class="stack">
                                            {#each sel.phones as p}<span
                                                    >{#if sel.labels?.phones?.[p]}<span
                                                            class="cx-label"
                                                            >{label_text(
                                                                sel.labels.phones[p],
                                                            )}</span
                                                        >{/if}{p}</span
                                                >{/each}
                                        </div>
                                    {:else}—{/if}
                                </div>
                            </div>
                            {#if sel.company}
                                <div class="cx-inforow">
                                    <div class="cx-inforow__label">Company</div>
                                    <div class="cx-inforow__value">
                                        {sel.company}
                                    </div>
                                </div>
                            {/if}
                            {#if sel.address}
                                <div class="cx-inforow">
                                    <div class="cx-inforow__label">Address</div>
                                    <div class="cx-inforow__value cx-inforow__value--text"
                                        >{sel.address}</div
                                    >
                                </div>
                            {/if}
                        </div>

                        {#if sel.notes}
                            <div class="cx-infocard">
                                <div class="cx-infocard__head">Notes</div>
                                <div class="cx-inforow">
                                    <div class="cx-inforow__value cx-inforow__value--text"
                                        >{sel.notes}</div
                                    >
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="cx-footer">
                        <Button variant="secondary" onclick={() => startEdit()}
                            >Edit</Button
                        >
                        <Button variant="secondary" onclick={startMerge}
                            >Merge…</Button
                        >
                        <div style="flex:1;"></div>
                        <Button variant="danger" onclick={remove}>Delete</Button
                        >
                    </div>
                {:else}
                    <div class="cx-placeholder">
                        <img
                            src={appIcon}
                            width="48"
                            height="48"
                            alt=""
                            style="opacity:.5;"
                        />
                        <div
                            style="font-size:var(--text-lg);color:var(--text-secondary);"
                        >
                            No contact selected
                        </div>
                        <div style="font-size:var(--text-sm);">
                            Pick someone from the list to see their details.
                        </div>
                    </div>
                {/if}
            {:else if form}
                <div
                    style="padding:18px 28px;background:var(--surface-panel);border-bottom:1px solid var(--border-default);"
                >
                    <div style="font-size:var(--text-xl);">
                        {mode === "new" ? "New contact" : "Edit contact"}
                    </div>
                </div>
                <div class="cx-detailbody">
                    <div class="cx-form">
                        <div class="cx-formrow">
                            <Input
                                label="First name"
                                bind:value={form.firstName}
                                placeholder="Jane"
                            />
                            <Input
                                label="Last name"
                                bind:value={form.lastName}
                                placeholder="Doe"
                            />
                        </div>
                        <div class="cx-formrow">
                            <Input
                                label="Job title"
                                bind:value={form.jobTitle}
                                placeholder="Product Manager"
                            />
                            <Input
                                label="Company"
                                bind:value={form.company}
                                placeholder="Sobamail"
                            />
                        </div>

                        <div class="cx-formcol">
                            <span class="vm-field__label">Emails</span>
                            {#each form.emails as _, i}
                                <div class="cx-multirow">
                                    <Input
                                        bind:value={form.emails[i]}
                                        placeholder="name@example.com"
                                        invalid={!email_ok(form.emails[i])}
                                    />
                                    <select
                                        class="cx-labelselect"
                                        aria-label="Email label"
                                        bind:value={emailLabels[i]}
                                    >
                                        {#each LABEL_OPTIONS.emails as o}
                                            <option value={o}>{label_text(o)}</option>
                                        {/each}
                                    </select>
                                    <button
                                        type="button"
                                        class="cx-minibtn"
                                        aria-label="Remove email"
                                        onclick={() => removeEmail(i)}>−</button
                                    >
                                </div>
                            {/each}
                            {#if formBadEmails}
                                <span class="vm-field__hint vm-field__hint--err"
                                    >Check the highlighted addresses: they don't look
                                    like email addresses.</span
                                >
                            {/if}
                            <button
                                type="button"
                                class="cx-addlink"
                                onclick={addEmail}>+ add email</button
                            >
                        </div>

                        <div class="cx-formcol">
                            <span class="vm-field__label">Phones</span>
                            {#each form.phones as _, i}
                                <div class="cx-multirow">
                                    <Input
                                        bind:value={form.phones[i]}
                                        placeholder="+1 415 555 0100"
                                    />
                                    <select
                                        class="cx-labelselect"
                                        aria-label="Phone label"
                                        bind:value={phoneLabels[i]}
                                    >
                                        {#each LABEL_OPTIONS.phones as o}
                                            <option value={o}>{label_text(o)}</option>
                                        {/each}
                                    </select>
                                    <button
                                        type="button"
                                        class="cx-minibtn"
                                        aria-label="Remove phone"
                                        onclick={() => removePhone(i)}>−</button
                                    >
                                </div>
                            {/each}
                            <button
                                type="button"
                                class="cx-addlink"
                                onclick={addPhone}>+ add phone</button
                            >
                        </div>

                        <div class="cx-formcol">
                            <span class="vm-field__label">Address</span>
                            <textarea
                                class="cx-textarea"
                                rows="2"
                                bind:value={form.address}
                            ></textarea>
                        </div>

                        <div class="cx-formcol">
                            <span class="vm-field__label">Notes</span>
                            <textarea
                                class="cx-textarea"
                                rows="3"
                                bind:value={form.notes}
                            ></textarea>
                        </div>

                        <Input
                            label="Tags"
                            placeholder="comma separated (drives the Groups sidebar)"
                            bind:value={tagsText}
                        />
                    </div>
                </div>
                <div class="cx-footer">
                    <Button
                        variant="go"
                        disabled={formEmpty || formBadEmails}
                        onclick={save}
                        >{mode === "new"
                            ? "Create contact"
                            : "Save contact"}</Button
                    >
                    <Button variant="secondary" onclick={cancel}>Cancel</Button>
                </div>
            {/if}
        </div>
    </div>
</div>

<svelte:window
    onhashchange={openFragment}
    onkeydown={(e) => {
        if (exporting && e.key === "Escape") {
            exporting = false;
            return;
        }
        if (importing && !importRunning && e.key === "Escape") {
            importing = false;
            return;
        }
        if (merging && !mergeRunning && e.key === "Escape") {
            merging = false;
            return;
        }
        if (!confirmingDelete) return;
        if (e.key === "Escape") confirmingDelete = false;
        else if (e.key === "Enter") {
            // without this, Enter also clicks the still-focused Delete button
            // behind the overlay, which re-arms this dialog
            e.preventDefault();
            confirmDelete();
        }
    }}
/>

{#if confirmingDelete && sel}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="cx-modal-overlay"
        onclick={(e) => {
            if (e.target === e.currentTarget) confirmingDelete = false;
        }}
    >
        <div
            class="cx-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Delete contact"
        >
            <div class="cx-modal__title">Delete contact?</div>
            <div class="cx-modal__body">
                Delete <strong>{fullName(sel)}</strong>? This can’t be undone.
            </div>
            <div class="cx-modal__actions">
                <Button
                    variant="secondary"
                    onclick={() => (confirmingDelete = false)}>Cancel</Button
                >
                <Button variant="danger" onclick={confirmDelete}>Delete</Button>
            </div>
        </div>
    </div>
{/if}

{#if merging && sel}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="cx-modal-overlay"
        onclick={(e) => {
            if (e.target === e.currentTarget && !mergeRunning) merging = false;
        }}
    >
        <div
            class="cx-modal cx-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-label="Merge contacts"
        >
            <div class="cx-modal__title">Merge into {fullName(sel)}</div>
            <div class="cx-modal__body">
                {#if mergeFrom}
                    <strong>{fullName(mergeFrom)}</strong> is merged into
                    <strong>{fullName(sel)}</strong>: its emails, phones, tags and
                    notes are added, and the details {fullName(sel)} lacks are
                    taken from it. Then {fullName(mergeFrom)} is deleted. This
                    can’t be undone.
                {:else}
                    <div>Pick the contact to merge into this one.</div>
                    <div class="cx-search">
                        <input
                            bind:value={mergeQuery}
                            placeholder="Search contacts to merge"
                            oninput={findMergeCandidates}
                        />
                    </div>
                    <div class="cx-importlist">
                        {#each mergeCandidates as c (c.uuid)}
                            <button
                                type="button"
                                class="cx-importrow cx-mergerow"
                                onclick={() => (mergeFrom = c)}
                            >
                                <span class="cx-importrow__name"
                                    >{fullName(c)}</span
                                >
                                <span class="cx-importrow__sub"
                                    >{(fullName(c) !== c.emails?.[0] && c.emails?.[0]) ||
                                        c.phones?.[0] ||
                                        ""}</span
                                >
                            </button>
                        {:else}
                            <div class="vm-field__hint">No other contacts found.</div>
                        {/each}
                    </div>
                {/if}
            </div>
            <div class="cx-modal__actions">
                {#if mergeFrom}
                    <Button
                        variant="secondary"
                        disabled={mergeRunning}
                        onclick={() => (mergeFrom = null)}>Back</Button
                    >
                    <Button
                        variant="danger"
                        disabled={mergeRunning}
                        onclick={confirmMerge}>Merge</Button
                    >
                {:else}
                    <Button variant="secondary" onclick={() => (merging = false)}
                        >Cancel</Button
                    >
                {/if}
            </div>
        </div>
    </div>
{/if}

{#if importing}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="cx-modal-overlay"
        onclick={(e) => {
            if (e.target === e.currentTarget && !importRunning) importing = false;
        }}
    >
        <div
            class="cx-modal cx-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-label="Import contacts"
        >
            <div class="cx-modal__title">Import contacts</div>
            <div class="cx-modal__body">
                {#if importRows.length === 0}
                    The file holds no contacts to import.
                {:else}
                    <div>
                        {importChosen} of {importRows.length} chosen ·
                        <button
                            type="button"
                            class="cx-addlink"
                            disabled={importStarted}
                            onclick={() => chooseAll(true)}>all</button
                        >
                        <button
                            type="button"
                            class="cx-addlink"
                            disabled={importStarted}
                            onclick={() => chooseAll(false)}>none</button
                        >
                    </div>
                    <div class="cx-importlist">
                        {#each importRows as r, i}
                            <label class="cx-importrow">
                                <input
                                    type="checkbox"
                                    bind:checked={importRows[i].chosen}
                                    disabled={importStarted}
                                />
                                <span class="cx-importrow__name"
                                    >{import_name(r.person)}</span
                                >
                                <span class="cx-importrow__sub"
                                    >{r.person.emails[0] ?? r.person.phones[0] ?? ""}</span
                                >
                                {#if r.known}
                                    <span class="cx-importrow__known"
                                        >already in your contacts</span
                                    >
                                {/if}
                            </label>
                        {/each}
                    </div>
                {/if}
                {#if importSkipped}
                    <div class="vm-field__hint">
                        {importSkipped}
                        {importSkipped === 1 ? "card has" : "cards have"} nothing
                        to import.
                    </div>
                {/if}
                {#if importStarted}
                    <progress
                        class="cx-progress"
                        max={importTotal}
                        value={importDone}
                        aria-label="Import progress"
                    ></progress>
                    <div class="vm-field__hint">
                        {importStatus ||
                            `Importing ${importDone} of ${importTotal}…`}
                    </div>
                {/if}
            </div>
            <div class="cx-modal__actions">
                {#if importRunning}
                    <Button variant="secondary" onclick={() => (importStop = true)}
                        >Stop</Button
                    >
                {:else if importStarted}
                    <Button variant="go" onclick={() => (importing = false)}
                        >Close</Button
                    >
                {:else}
                    <Button variant="secondary" onclick={() => (importing = false)}
                        >Cancel</Button
                    >
                    <Button
                        variant="go"
                        disabled={importChosen === 0}
                        onclick={runImport}
                        >Import {importChosen}
                        {importChosen === 1 ? "contact" : "contacts"}</Button
                    >
                {/if}
            </div>
        </div>
    </div>
{/if}

{#if exporting}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="cx-modal-overlay"
        onclick={(e) => {
            if (e.target === e.currentTarget) exporting = false;
        }}
    >
        <div
            class="cx-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export as vCard"
        >
            <div class="cx-modal__title">Export as vCard</div>
            <div class="cx-modal__body">
                <label class="cx-radio">
                    <input
                        type="radio"
                        bind:group={exportAll}
                        value={false}
                        disabled={!sel}
                    />
                    {sel ? fullName(sel) : "The selected contact"}
                </label>
                <label class="cx-radio">
                    <input type="radio" bind:group={exportAll} value={true} />
                    All contacts
                </label>
                <div class="cx-sendrow">
                    <Input
                        label="Send by email to"
                        placeholder="name@example.com, …"
                        bind:value={sendTo}
                        invalid={sendTo.trim() !== "" && !recipientsOk}
                    />
                    <Button
                        variant="secondary"
                        disabled={!recipientsOk}
                        onclick={sendVCard}>Send</Button
                    >
                </div>
                {#if exportStatus}
                    <div class="vm-field__hint">{exportStatus}</div>
                {/if}
            </div>
            <div class="cx-modal__actions">
                <Button variant="secondary" onclick={() => (exporting = false)}
                    >Close</Button
                >
                <Button variant="go" onclick={exportVCard}>Download .vcf</Button>
            </div>
        </div>
    </div>
{/if}
