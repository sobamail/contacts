<script lang="ts">
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import {
        Person,
        type GroupInfo,
        type GroupMemberInfo,
        type TagInfo,
    } from "$module/contacts/v1";
    import {
        read_people,
        read_person,
        read_tags,
        read_groups,
        read_group_members,
        put_person,
        delete_person,
        send_vcard,
        watch_people,
        watch_presence,
        TAG_REPLIED,
    } from "$lib/model";
    import {
        address_presence,
        badge_presence,
        fold,
        member_matches,
        member_name,
        BADGE_PRESENCE_TEXT,
        type BadgePresence,
        type Presence,
    } from "$lib/groups";
    import {
        parse_fragment,
        shown_panes,
        open_full,
        card_fragment,
        email_fragment,
        split_name,
        same_name,
        holds_email,
        type Pane,
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
    import StatusDot from "./lib/components/StatusDot.svelte";
    import Button from "./lib/components/Button.svelte";
    import IconButton from "./lib/components/IconButton.svelte";
    import Tag from "./lib/components/Tag.svelte";
    import Input from "./lib/components/Input.svelte";
    import ViewPicker from "./lib/components/ViewPicker.svelte";

    const icTb = (n: string) => `/ds/assets/icons/toolbar/${n}.svg`;
    const appIcon = "/ds/assets/icons/app/icon-16.svg";

    // ---- App state ----
    let people: Person[] = $state([]);
    let selectedUuid: string | null = $state(null);
    // The selected person as last fetched, for when the loaded pages don't
    // hold it (a big address book, a contact saved just now).
    let selectedCard = $state<Person | null>(null);
    let query = $state(""); // server-side search filter (client-side in a group)
    // the tags picked in the search box: the list shows the contacts carrying them all
    let tagChips = $state<string[]>([]);
    // what the list shows, picked in the combobox: "all" or a read-only group
    // ("group:<uuid>")
    let view = $state("all");
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
    // The backend implements `filter` (search), `tagFilter` (the picked tags)
    // and limit/offset.
    // Plain variables on purpose: changing them must not re-run the effect.
    let fetchSeq = 0; // only the newest request may apply its reply
    let lastQuery = "";

    $effect(() => {
        const _r = reload;
        const q = query; // track: re-fetch when the search changes
        const tags = [...tagChips]; // track: and when a tag is picked or dropped
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
                read_people(q, tags, pageSize, o)
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

    // ---- Live updates (lib/model watch_people) -----------------------------
    // A change made anywhere (another window, another device) rereads what is
    // shown: the loaded pages in one request, so the scroll position stays and
    // the next page follows on from them, and the selected contact.
    async function refreshLive() {
        loadGroups();
        loadTags();
        if (groupUuid) loadMembers(groupUuid);
        const seq = ++fetchSeq; // drops a fetch in flight; this one covers it
        const upto = offset + pageSize;
        try {
            const r = await read_people(query, [...tagChips], upto, 0);
            if (seq === fetchSeq) {
                people = r;
                lastCount = r.length - offset;
            }
        } catch (err) {
            console.error("live refresh:", err);
        } finally {
            if (seq === fetchSeq) {
                isLoading = false;
                isAppending = false;
            }
        }
        const uuid = selectedUuid;
        if (uuid && !people.some((p) => p.uuid === uuid)) {
            try {
                const card = await read_person(uuid);
                if (selectedUuid === uuid) selectedCard = card;
            } catch (err) {
                console.error("live refresh:", err);
            }
        }
    }

    onMount(() => watch_people(refreshLive));

    // ---- Tags in the search box --------------------------------------------
    // The search box completes the tags of every contact (GetTags), loaded
    // or not. A picked one becomes a chip ahead of the text and goes out as
    // tagFilter; the text keeps searching within the picked tags.
    let allTags = $state<TagInfo[]>([]);
    let tagsSeq = 0; // only the newest request may apply its reply
    let searchInput: HTMLInputElement | null = $state(null);
    let suggestOpen = $state(false);
    let suggestActive = $state(-1); // the suggestion under the keyboard, -1 for none
    let suggestPanel: HTMLElement | null = $state(null);

    async function loadTags() {
        const seq = ++tagsSeq;
        try {
            const t = await read_tags();
            if (seq === tagsSeq) allTags = t;
        } catch (err) {
            console.error("read_tags:", err);
        }
    }

    $effect(() => {
        const _r = reload;
        loadTags();
    });

    // the tags not picked yet whose name holds the text, folded like the search
    const suggestions = $derived.by(() => {
        if (!suggestOpen || view !== "all") return [];
        const needle = fold(query.trim());
        return allTags.filter(
            (t) => !tagChips.includes(t.name) && fold(t.name).includes(needle),
        );
    });

    function resetPaging() {
        offset = 0;
        isAppending = false;
    }
    function pickTag(name: string) {
        tagChips = [...tagChips, name];
        query = ""; // the text that found the tag
        suggestActive = -1;
        resetPaging();
        searchInput?.focus();
    }
    function dropTag(name: string) {
        tagChips = tagChips.filter((t) => t !== name);
        resetPaging();
    }
    function onSearchKeydown(e: KeyboardEvent) {
        if (e.key === "Backspace" && !query && tagChips.length > 0 && view === "all") {
            dropTag(tagChips[tagChips.length - 1]);
        } else if (e.key === "Escape") {
            suggestOpen = false;
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!suggestOpen) {
                suggestOpen = true;
                return;
            }
            if (suggestions.length === 0) return;
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            suggestActive = Math.min(
                suggestions.length - 1,
                Math.max(0, suggestActive + step),
            );
            suggestPanel
                ?.querySelectorAll("[role=option]")
                [suggestActive]?.scrollIntoView?.({ block: "nearest" });
        } else if (e.key === "Enter" && suggestions[suggestActive]) {
            e.preventDefault();
            pickTag(suggestions[suggestActive].name);
        }
    }

    // ---- Groups (read-only, kept by the server) ----------------------------
    // A group lists member addresses; each comes with the contact holding it,
    // if any. The search box filters the members here.
    let groups = $state<GroupInfo[]>([]);
    let members = $state<GroupMemberInfo[]>([]);
    // the colleagues' known statuses, by lowercased address, as the host streams them
    // (lib/model watch_presence)
    const presence = new SvelteMap<string, Presence>();
    onMount(() =>
        watch_presence((address, p) => {
            if (p) presence.set(address, p);
            else presence.delete(address);
        }),
    );
    // the member shown, by address: a member may have no contact
    let selectedAddress = $state<string | null>(null);
    let membersLoading = $state(false);
    let membersSeq = 0; // only the newest request may apply its reply
    // every group's members, lowercased: the people whose badge shows a status, unknown or not
    let mates = $state<ReadonlySet<string>>(new Set());
    let matesSeq = 0;

    const groupUuid = $derived(
        view.startsWith("group:") ? view.slice("group:".length) : null,
    );
    const activeGroup = $derived(
        groups.find((g) => g.uuid === groupUuid) ?? null,
    );

    async function loadGroups() {
        try {
            groups = await read_groups();
        } catch (err) {
            console.error("read_groups:", err);
            return;
        }

        // the group mates: everyone the account's groups list, the server keeping only the
        // groups the account is in
        const seq = ++matesSeq;
        try {
            const lists = await Promise.all(groups.map((g) => read_group_members(g.uuid)));
            if (seq !== matesSeq) return;
            mates = new Set(
                lists.flat().map((m) => m.address.trim().toLowerCase()),
            );
        } catch (err) {
            console.error("read_group_members:", err);
        }
    }

    async function loadMembers(uuid: string) {
        const seq = ++membersSeq;
        membersLoading = true;
        try {
            const m = await read_group_members(uuid);
            if (seq !== membersSeq) return;
            members = m;
        } catch (err) {
            if (seq === membersSeq) members = [];
            console.error("read_group_members:", err);
        } finally {
            if (seq === membersSeq) membersLoading = false;
        }
    }

    $effect(() => {
        const _r = reload;
        loadGroups();
    });

    $effect(() => {
        const _r = reload;
        const g = groupUuid;
        if (g) {
            loadMembers(g);
        } else {
            ++membersSeq;
            members = [];
            membersLoading = false;
        }
    });

    // a group the server deleted leaves the combobox: back to everyone
    $effect(() => {
        if (groupUuid && !activeGroup) {
            view = "all";
            selectedAddress = null;
        }
    });

    const shownMembers = $derived(
        members.filter((m) => member_matches(m, query)),
    );
    const selMember = $derived(
        groupUuid
            ? (members.find((m) => m.address === selectedAddress) ?? null)
            : null,
    );
    // The status dot of a badge, wherever a person's badge is shown: the most present
    // status of the addresses it stands for -- a contact's emails, a member's address --,
    // unknown for a group mate while none is known, and none for anyone else.
    const presenceOf = (
        addresses: readonly (string | null | undefined)[],
    ): BadgePresence | "" => badge_presence(presence, mates, addresses) ?? "";
    const dotText = (p: BadgePresence | "") => (p ? BADGE_PRESENCE_TEXT[p] : "");
    const presenceText = (addresses: readonly (string | null | undefined)[]) =>
        dotText(presenceOf(addresses));
    // The dot of one of the shown person's addresses in the contact card, while their badge
    // has one: its own status, unknown for one of no known status.
    const addressDot = (address: string): BadgePresence | "" =>
        presenceOf(selAddresses) &&
        (address_presence(presence, mates, address) ?? "unknown");
    // the addresses a contact's badge stands for, and a member's
    const personAddresses = (p: Person | null | undefined) => p?.emails ?? [];
    const memberAddresses = (m: GroupMemberInfo) => [
        m.address,
        ...personAddresses(m.person),
    ];
    // the shown contact's: its emails, and the member's address it is shown as
    const selAddresses = $derived.by(() => [
        ...(selMember ? [selMember.address] : []),
        ...personAddresses(sel),
    ]);
    // the detail head's line under a member's name
    const memberLine = () => `In ${activeGroup?.name || "this group"}`;

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

    // the combobox: everyone, then the server's groups
    const pickerSections = $derived([
        {
            label: "Lists",
            options: [{ key: "all", name: "All contacts", count: people.length }],
        },
        {
            label: "Groups",
            options: groups.map((g) => ({
                key: `group:${g.uuid}`,
                name: g.name || "(unnamed group)",
                count: g.size,
            })),
        },
    ]);

    // The server pages people in display order (by last name, then first
    // name, nameless last), so the loaded pages are a prefix of the full list
    // and are kept as they come, grouped into alphabetical sections by last
    // name.
    const sections = $derived.by(() => {
        const map: Record<string, Person[]> = {};
        const order: string[] = [];
        for (const p of people) {
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

    const countLabel = $derived(
        groupUuid
            ? `${shownMembers.length} ${shownMembers.length === 1 ? "member" : "members"} · read-only`
            : `${people.length} ${people.length === 1 ? "contact" : "contacts"}`,
    );
    const noSel = $derived(!sel || isForm);

    // ---- Actions ---------------------------------------------------------
    function select(uuid: string) {
        // the narrow view has no card pane: the full app shows the card
        if (!showRight) {
            open_full(card_fragment(uuid));
            return;
        }
        launchHint = null;
        selectedUuid = uuid;
        selectedAddress = null;
        mode = "view";
    }
    // a group member: its contact when it has one, else the bare address
    function selectMember(m: GroupMemberInfo) {
        if (!showRight) {
            open_full(
                m.person
                    ? card_fragment(m.person.uuid)
                    : email_fragment(m.address, member_name(m) === m.address ? "" : member_name(m)),
            );
            return;
        }
        launchHint = null;
        selectedAddress = m.address;
        selectedUuid = m.person?.uuid ?? null;
        selectedCard = m.person ? new Person(m.person) : null;
        mode = "view";
    }
    function pickView() {
        // a group's members carry no tags
        if (tagChips.length > 0) {
            tagChips = [];
            resetPaging();
        }
        launchHint = null;
        selectedAddress = null;
        mode = "view";
    }

    // `init` and `patch` pre-fill the form, as a launch fragment does.
    function startNew(init: Partial<Person> = {}) {
        // spread into a PLAIN object — Svelte 5 $state only deep-proxies plain
        // objects/arrays, not class instances, so array edits stay reactive.
        form = { ...new Person(init) };
        formBase = null;
        loadFormLists(form);
        launchHint = null;
        selectedUuid = null;
        selectedAddress = null;
        mode = "new";
    }
    // a group member without a contact becomes one; it stays the member shown
    function addMember(address: string) {
        startNew({ emails: [address] });
        selectedAddress = address;
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
        launchHint = null;
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
    // the card holding the email; under another name, the card suggests the
    // new name; with no card, the address is shown with a suggestion to add it.
    let fragmentSeq = 0; // a newer fragment wins over a lookup in flight

    // What a person/show launch suggests: "rename" the card `uuid` to `name`,
    // or "add" `email` under `name`. It goes when the user takes it, dismisses
    // it or shows something else.
    type LaunchHint =
        | { kind: "rename"; uuid: string; name: string }
        | { kind: "add"; email: string; name: string };
    let launchHint = $state<LaunchHint | null>(null);

    // The rename alone, as the client's collect writes it: the base holds the
    // old name, so nothing else the card holds is touched. Taking it is the
    // user's edit, so the Replied tag goes, as on a save from the form.
    async function useLaunchName() {
        const h = launchHint;
        if (h?.kind !== "rename") return;
        const [firstName, lastName] = split_name(h.name);
        try {
            const cur = (await read_person(h.uuid)) ?? sel;
            if (!cur) return;
            const tags = cur.tags ?? [];
            await put_person(
                new Person({
                    uuid: h.uuid,
                    firstName,
                    lastName,
                    tags: tags.filter((t) => t !== TAG_REPLIED),
                }),
                new Person({
                    firstName: cur.firstName,
                    lastName: cur.lastName,
                    tags: [...tags],
                }),
            );
            if (launchHint === h) launchHint = null;
            offset = 0;
            isAppending = false;
            reload += 1; // refetch list
            if (selectedUuid === h.uuid) selectedCard = await read_person(h.uuid);
        } catch (err) {
            alert(String(err));
        }
    }

    function addLaunchAddress() {
        const h = launchHint;
        if (h?.kind !== "add") return;
        const [firstName, lastName] = split_name(h.name);
        startNew({ firstName, lastName, emails: [h.email] });
    }

    // pane/<pane>[,<pane>] shows the named panes alone; read before the first
    // render, so the narrow view never flashes the whole app
    let panes = $state<Pane[]>(shown_panes(location.hash));
    const showLeft = $derived(panes.includes("left"));
    const showRight = $derived(panes.includes("right"));

    async function openFragment() {
        const f = parse_fragment(location.hash);
        if (f === null) return; // the app's root

        // the panes stay in the URL, so a reload keeps them
        if (f !== "invalid" && f.action === "pane") {
            panes = f.panes;
            return;
        }

        // Handled or invalid, the fragment goes: a reload doesn't apply it
        // again, and the same launch again changes the hash, so it is seen.
        history.replaceState(null, "", location.pathname + location.search);
        if (f === "invalid") return;

        launchHint = null;
        const seq = ++fragmentSeq;
        if (f.action === "new") {
            startNew();
            return;
        }
        if (f.action === "card") {
            // not select(): a narrow view would hand it straight back out
            selectedUuid = f.uuid;
            selectedAddress = null;
            mode = "view";
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

        const named = (p: Person) =>
            same_name(p.firstName ?? "", p.lastName ?? "", f.name);
        // several cards can hold one address; prefer one under this name
        const card = matches.find(named) ?? matches[0];
        form = null;
        mode = "view";
        selectedAddress = null;
        if (!card) {
            selectedUuid = null;
            launchHint = { kind: "add", email: f.email, name: f.name };
            return;
        }

        selectedUuid = card.uuid;
        selectedCard = card;
        if (f.name && !named(card)) {
            launchHint = { kind: "rename", uuid: card.uuid, name: f.name };
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
            selectedAddress = null;
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
    <!-- Toolbar: it acts on the right pane, so it goes with it -->
    <div class="cx-toolbar" class:cx-hidden={!showRight}>
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
        <!-- Contact list: the list or group picked above, the search below -->
        <div
            class="cx-listpane"
            class:cx-hidden={!showLeft}
            class:cx-listpane--alone={!showRight}
        >
            <div class="cx-listhead">
                <ViewPicker
                    label="Contact list"
                    sections={pickerSections}
                    bind:value={view}
                    onchange={pickView}
                />
                <div class="cx-listtitle">
                    <span>{countLabel}</span>
                    <!-- the loaded contacts say nothing about a group -->
                    {#if groupUuid}
                        {#if membersLoading}<span>Syncing…</span>{/if}
                    {:else}
                        <span
                            >{isLoading ? "Syncing…" : `${people.length} loaded`}</span
                        >
                    {/if}
                </div>
                <div class="cx-search">
                    <img
                        src={icTb("search")}
                        width="16"
                        height="16"
                        alt=""
                        style="opacity:.8;"
                    />
                    {#if !groupUuid}
                        {#each tagChips as t (t)}
                            <Tag
                                onRemove={() => dropTag(t)}
                                removeLabel={`Remove tag ${t}`}>{t}</Tag
                            >
                        {/each}
                    {/if}
                    <input
                        bind:this={searchInput}
                        bind:value={query}
                        role="combobox"
                        aria-label={groupUuid ? "Search members" : "Search contacts"}
                        aria-autocomplete="list"
                        aria-controls="cx-tag-suggestions"
                        aria-expanded={suggestions.length > 0}
                        autocomplete="off"
                        placeholder={groupUuid ? "Search members" : "Search contacts"}
                        oninput={() => {
                            resetPaging();
                            suggestOpen = true;
                            suggestActive = -1;
                        }}
                        onfocus={() => (suggestOpen = true)}
                        onblur={() => (suggestOpen = false)}
                        onkeydown={onSearchKeydown}
                    />
                    {#if suggestions.length > 0}
                        <div
                            class="cx-picker__panel"
                            id="cx-tag-suggestions"
                            role="listbox"
                            aria-label="Tags"
                            bind:this={suggestPanel}
                        >
                            <div class="cx-picker__head">Tags</div>
                            {#each suggestions as s, i (s.name)}
                                <!-- the mousedown keeps the focus in the search box -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <div
                                    class="cx-picker__option"
                                    class:cx-picker__option--active={i === suggestActive}
                                    role="option"
                                    tabindex="-1"
                                    aria-selected={i === suggestActive}
                                    onmousedown={(e) => e.preventDefault()}
                                    onclick={() => pickTag(s.name)}
                                    onmouseenter={() => (suggestActive = i)}
                                >
                                    <span class="cx-picker__name">{s.name}</span>
                                    <span class="cx-picker__count">{s.count}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            <div class="cx-list">
                {#if groupUuid}
                    {#each shownMembers as m (m.address)}
                        <button
                            class="cx-row {m.address === selectedAddress &&
                            !isForm
                                ? 'cx-row--selected'
                                : ''}"
                            onclick={() => selectMember(m)}
                        >
                            <Avatar
                                name={member_name(m)}
                                size={40}
                                status={presenceOf(memberAddresses(m))}
                                statusLabel={presenceText(memberAddresses(m))}
                            />
                            <div style="flex:1;min-width:0;">
                                <div class="cx-row__name">{member_name(m)}</div>
                                <div class="cx-row__sub">
                                    {m.person
                                        ? member_name(m) === m.address
                                            ? ""
                                            : m.address
                                        : "Not in your contacts"}
                                </div>
                            </div>
                        </button>
                    {:else}
                        {#if !membersLoading}
                            <div class="cx-empty">
                                <div
                                    style="font-size:var(--text-md);color:var(--text-secondary);"
                                >
                                    No members found
                                </div>
                            </div>
                        {/if}
                    {/each}
                    {#if membersLoading}
                        <div class="cx-loading">Loading…</div>
                    {/if}
                {:else if people.length > 0}
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
                                <Avatar
                                    name={fullName(c)}
                                    size={40}
                                    status={presenceOf(personAddresses(c))}
                                    statusLabel={presenceText(personAddresses(c))}
                                />
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
                            Try a different search or tag.
                        </div>
                    </div>
                {/if}

                {#if isLoading && !groupUuid}
                    <div class="cx-loading">Loading…</div>
                {/if}

                <!-- infinite-scroll sentinel -->
                {#if lastCount >= pageSize && !groupUuid}
                    <div
                        class="cx-sentinel"
                        bind:this={sentinel}
                        aria-hidden="true"
                    ></div>
                {/if}
            </div>
        </div>

        <!-- Detail / form pane -->
        <div class="cx-detail" class:cx-hidden={!showRight}>
            {#if !isForm}
                {#if sel}
                    <div class="cx-detailhead">
                        <Avatar
                            name={fullName(sel)}
                            size={72}
                            status={presenceOf(selAddresses)}
                            statusLabel={presenceText(selAddresses)}
                        />
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
                            {#if selMember}
                                <div class="cx-memberof">
                                    {memberLine()}
                                </div>
                            {/if}
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
                        {#if launchHint?.kind === "rename" && launchHint.uuid === sel.uuid}
                            <div
                                class="cx-suggest"
                                role="status"
                                aria-label="Name suggestion"
                            >
                                <span class="cx-suggest__text"
                                    >The message names this contact <b
                                        >{launchHint.name}</b
                                    >.</span
                                >
                                <Button size="sm" onclick={useLaunchName}
                                    >Use this name</Button
                                >
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onclick={() => (launchHint = null)}
                                    >Dismiss</Button
                                >
                            </div>
                        {/if}
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
                                                        >{/if}<StatusDot
                                                        status={addressDot(e)}
                                                        label={dotText(addressDot(e))}
                                                    /><a
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
                {:else if selMember}
                    <!-- a group member no contact holds -->
                    <div class="cx-detailhead">
                        <Avatar
                            name={selMember.address}
                            size={72}
                            status={presenceOf(memberAddresses(selMember))}
                            statusLabel={presenceText(memberAddresses(selMember))}
                        />
                        <div style="flex:1;min-width:0;">
                            <div
                                style="font-size:var(--text-2xl);line-height:1.15;"
                            >
                                {selMember.address}
                            </div>
                            <div
                                style="font-size:var(--text-md);color:var(--text-secondary);margin-top:3px;"
                            >
                                Not in your contacts
                            </div>
                            <div class="cx-memberof">
                                {memberLine()}
                            </div>
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
                                    <StatusDot
                                        status={presenceOf([selMember.address])}
                                        label={presenceText([selMember.address])}
                                    /><a
                                        class="cx-maillink"
                                        href={mailto(selMember.address)}
                                        >{selMember.address}</a
                                    >
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="cx-footer">
                        <Button
                            variant="go"
                            onclick={() => addMember(selMember!.address)}
                            >Add to contacts</Button
                        >
                    </div>
                {:else if launchHint?.kind === "add"}
                    <!-- a launch's address no contact holds -->
                    <div class="cx-detailhead">
                        <Avatar
                            name={launchHint.name || launchHint.email}
                            size={72}
                            status={presenceOf([launchHint.email])}
                            statusLabel={presenceText([launchHint.email])}
                        />
                        <div style="flex:1;min-width:0;">
                            <div
                                style="font-size:var(--text-2xl);line-height:1.15;"
                            >
                                {launchHint.name || launchHint.email}
                            </div>
                            <div
                                style="font-size:var(--text-md);color:var(--text-secondary);margin-top:3px;"
                            >
                                Not in your contacts
                            </div>
                        </div>
                    </div>
                    <div class="cx-detailbody">
                        <div
                            class="cx-suggest"
                            role="status"
                            aria-label="Add suggestion"
                        >
                            <span class="cx-suggest__text"
                                >Add {launchHint.name || launchHint.email} to your
                                contacts?</span
                            >
                            <Button
                                variant="go"
                                size="sm"
                                onclick={addLaunchAddress}
                                >Add to contacts</Button
                            >
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={() => (launchHint = null)}
                                >Dismiss</Button
                            >
                        </div>
                        <div class="cx-infocard">
                            <div class="cx-infocard__head">Contact details</div>
                            <div class="cx-inforow">
                                <div class="cx-inforow__label">Email</div>
                                <div
                                    class="cx-inforow__value"
                                    style="color:var(--text-link);font-family:var(--font-mono);"
                                >
                                    <StatusDot
                                        status={presenceOf([launchHint.email])}
                                        label={presenceText([launchHint.email])}
                                    /><a
                                        class="cx-maillink"
                                        href={mailto(launchHint.email)}
                                        >{launchHint.email}</a
                                    >
                                </div>
                            </div>
                        </div>
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
                            placeholder="comma separated"
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

<div class="cx-version">v{__MUTATOR_VERSION__}</div>

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
