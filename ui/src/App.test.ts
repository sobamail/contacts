// @vitest-environment jsdom

// App.svelte against the real module on the stand-in runtime (test/backend.ts): the
// list, the detail view, the form, deleting, launch fragments, export and import.

import { decode } from "@msgpack/msgpack";
import { render, screen, waitFor, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
    AddGroupMember,
    GetPerson,
    Person,
    PutPerson,
    PutPersonResponse,
    SetAttrGroup,
    type PersonData,
} from "$module/contacts/v1";
import App from "./App.svelte";
import { install_backend, type Backend, type FakeMessage } from "./test/backend";

let backend: Backend;

beforeEach(async () => {
    backend = await install_backend();
    history.replaceState(null, "", "/");
    window.alert = vi.fn();
});

const put = (content: Partial<PersonData>) =>
    backend.soba.run<PutPersonResponse>(new PutPerson(content))!.uuid;
const get = (uuid: string) => backend.soba.run<Person>(new GetPerson({ uuid }))!;

const rowNames = () =>
    [...document.querySelectorAll(".cx-row__name")].map((e) => e.textContent!.trim());
const detailName = () => document.querySelector(".cx-detailhead")?.textContent ?? "";
const button = (name: string) => screen.getAllByRole("button", { name })[0] as HTMLButtonElement;

async function open(name: string) {
    const user = userEvent.setup();
    await user.click(await screen.findByText(name, { selector: ".cx-row__name" }));
    return user;
}

describe("the list", () => {
    it("shows everyone in name order, by last name, in letter sections", async () => {
        put({ firstName: "Zed", lastName: "Adams" });
        put({ firstName: "Cher" });
        put({ firstName: "Bob", lastName: "Allen" });
        render(App);

        await waitFor(() => expect(rowNames()).toEqual(["Zed Adams", "Bob Allen", "Cher"]));
        expect(
            [...document.querySelectorAll(".cx-sectionhead")].map((e) => e.textContent),
        ).toEqual(["A", "C"]);
    });

    it("shows a contact without a name by its email, in the last section", async () => {
        put({ firstName: "Bob", lastName: "Allen" });
        put({ emails: ["anon@example.com"] });
        put({ phones: ["+90 212 555 0000"] });
        render(App);

        // the two without a name tie, and the uuid breaks the tie: either order
        await waitFor(() => expect(rowNames()).toHaveLength(3));
        expect(rowNames()[0]).toBe("Bob Allen");
        expect(rowNames().slice(1).sort()).toEqual(["(no name)", "anon@example.com"]);
        expect(
            [...document.querySelectorAll(".cx-sectionhead")].map((e) => e.textContent),
        ).toEqual(["A", "#"]);
    });

    it("searches as you type, ignoring accents", async () => {
        put({ firstName: "Şükrü", lastName: "Kaya" });
        put({ firstName: "Some", lastName: "One" });
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(2));

        const user = userEvent.setup();
        await user.type(screen.getByPlaceholderText("Search contacts"), "sukru");
        await waitFor(() => expect(rowNames()).toEqual(["Şükrü Kaya"]));
    });
});

describe("tags in the search box", () => {
    const search = () => screen.getByRole("combobox", { name: "Search contacts" });
    // the suggestions as shown, "name count"; none when the panel is closed
    const suggestions = () =>
        [...(screen.queryByRole("listbox", { name: "Tags" })?.querySelectorAll("[role=option]") ?? [])].map(
            (o) => o.textContent!.trim().replace(/\s+/g, " "),
        );
    const chips = () =>
        [...document.querySelectorAll(".cx-search .vm-tag")].map((c) =>
            c.textContent!.replace("×", "").trim(),
        );
    const people = () => {
        put({ firstName: "Ann", lastName: "Adams", tags: ["Family", "Golf"] });
        put({ firstName: "Bob", lastName: "Allen", tags: ["Family"] });
        put({ firstName: "Cy", lastName: "Amis", tags: ["Çalışma"] });
        put({ firstName: "Fay", lastName: "Family" });
    };

    it("completes the tags as you type, ignoring case and accents", async () => {
        people();
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(4));
        expect(suggestions()).toEqual([]);

        const user = userEvent.setup();
        await user.click(search());
        // every tag, of every person, while nothing is typed
        await waitFor(() => expect(suggestions()).toEqual(["Çalışma 1", "Family 2", "Golf 1"]));
        await user.type(search(), "calis");
        expect(suggestions()).toEqual(["Çalışma 1"]);
        await user.clear(search());
        await user.type(search(), "zzz");
        expect(suggestions()).toEqual([]);
        expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    });

    it("narrows the list to a picked tag, sent as tagFilter, and to the text with it", async () => {
        people();
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(4));

        const user = userEvent.setup();
        await user.type(search(), "fam");
        // the text alone finds the name as well
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams", "Bob Allen", "Fay Family"]));
        await user.click(screen.getByRole("option", { name: /^Family / }));
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams", "Bob Allen"]));
        expect(chips()).toEqual(["Family"]);
        expect((search() as HTMLInputElement).value).toBe("");
        expect(document.activeElement).toBe(search());
        expect(
            backend.fetch.mock.calls
                .map(([, init]) => decode(init.body as Uint8Array) as { name: string; content: any })
                .filter((r) => r.name === "GetPeople")
                .at(-1)!.content,
        ).toMatchObject({ filter: "", tagFilter: ["Family"] });

        // a picked tag is not offered again; a second one narrows further
        await waitFor(() => expect(suggestions()).toEqual(["Çalışma 1", "Golf 1"]));
        await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams"]));
        expect(chips()).toEqual(["Family", "Golf"]);

        // text searches within the tags
        await user.type(search(), "bob");
        await waitFor(() => expect(rowNames()).toEqual([]));
    });

    it("drops a tag by its × and by Backspace in the empty box", async () => {
        people();
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(4));

        const user = userEvent.setup();
        await user.click(search());
        await user.click(await screen.findByRole("option", { name: /^Family / }));
        await user.click(await screen.findByRole("option", { name: /^Golf / }));
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams"]));

        await user.keyboard("{Backspace}");
        expect(chips()).toEqual(["Family"]);
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams", "Bob Allen"]));
        await user.click(screen.getByRole("button", { name: "Remove tag Family" }));
        expect(chips()).toEqual([]);
        await waitFor(() => expect(rowNames()).toHaveLength(4));
    });

    it("closes the suggestions on Escape, and Enter picks none unasked", async () => {
        people();
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(4));

        const user = userEvent.setup();
        await user.type(search(), "golf");
        expect(suggestions()).toEqual(["Golf 1"]);
        await user.keyboard("{Enter}");
        expect(chips()).toEqual([]);
        await user.keyboard("{Escape}");
        expect(suggestions()).toEqual([]);
        expect((search() as HTMLInputElement).value).toBe("golf");
    });
});

describe("lists and groups", () => {
    const acme = "{00000000-0000-4000-8000-0000000000a1}";
    const picker = () => screen.getByRole("combobox", { name: "Contact list" });
    // the picker's sections and options as shown, "name count"; it opens and closes it
    const optgroups = async () => {
        const user = userEvent.setup();
        await user.click(picker());
        const listbox = screen.getByRole("listbox", { name: "Contact list" });
        const ret = within(listbox)
            .getAllByRole("group")
            .map((g) => [
                g.getAttribute("aria-label"),
                within(g)
                    .getAllByRole("option")
                    .map((o) => o.textContent!.trim().replace(/\s+/g, " ")),
            ]);
        await user.keyboard("{Escape}");
        return ret;
    };
    const pick = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
        await user.click(picker());
        await user.click(screen.getByRole("option", { name: new RegExp(`^${name} `) }));
    };

    it("offers everyone alone in the combobox while there is no group", async () => {
        put({ firstName: "Ann", lastName: "Adams", tags: ["Family"] });
        put({ firstName: "Bob", lastName: "Allen" });
        render(App);
        await waitFor(() => expect(rowNames()).toHaveLength(2));

        // no groups: no Groups section; a tag is no list
        expect(await optgroups()).toEqual([["Lists", ["All contacts 2"]]]);
        expect(screen.queryByRole("listbox")).toBeNull(); // Escape closed it
    });

    it("shows a group's members read-only, with their status, contacts or not", async () => {
        put({ firstName: "Ann", lastName: "Adams", emails: ["ann@acme.com"] });
        put({ firstName: "Bob", lastName: "Allen" });
        backend.soba.run(new SetAttrGroup({ uuid: acme, key: "name", value: "Acme" }));
        backend.soba.run(new AddGroupMember({ uuid: acme, address: "ann@acme.com" }));
        backend.soba.run(new AddGroupMember({ uuid: acme, address: "cem@acme.com" }));
        render(App);
        await waitFor(async () =>
            expect(await optgroups()).toEqual([
                ["Lists", ["All contacts 2"]],
                ["Groups", ["Acme 2"]],
            ]),
        );

        const user = userEvent.setup();
        await pick(user, "Acme");
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams", "cem@acme.com"]));
        expect(screen.getByText("2 members · read-only")).toBeTruthy();
        // the loaded contacts are no count of the group's
        expect(screen.queryByText(/loaded$/)).toBeNull();
        // no status known: every member is a group mate, the grey dot of an unknown status
        await waitFor(() =>
            expect(
                [...document.querySelectorAll(".vm-avatar__status")].map((d) =>
                    d.getAttribute("title"),
                ),
            ).toEqual(["Status unknown", "Status unknown"]),
        );

        // a member with a contact shows the contact
        await open("Ann Adams");
        expect(detailName()).toContain("Ann Adams");
        expect(detailName()).toContain("In Acme");

        // one without is offered as a new contact
        await open("cem@acme.com");
        expect(detailName()).toContain("Not in your contacts");
        await user.click(button("Add to contacts"));
        expect((screen.getAllByPlaceholderText("name@example.com")[0] as HTMLInputElement).value).toBe(
            "cem@acme.com",
        );

        // the search filters the members
        await user.click(button("Cancel"));
        await user.type(screen.getByPlaceholderText("Search members"), "cem");
        await waitFor(() => expect(rowNames()).toEqual(["cem@acme.com"]));
    });

    it("dots the members by the status the host streams, unknown until it does", async () => {
        const { streams, presence } = stub_presence();

        backend.soba.run(new SetAttrGroup({ uuid: acme, key: "name", value: "Acme" }));
        backend.soba.run(new AddGroupMember({ uuid: acme, address: "Ann@acme.com" }));
        backend.soba.run(new AddGroupMember({ uuid: acme, address: "cem@acme.com" }));
        render(App);
        await waitFor(async () => expect(await optgroups()).toHaveLength(2));

        // the stream opened: the page asks for the colleagues online
        for (const s of streams) s.dispatchEvent(new Event("open"));
        await waitFor(() =>
            expect(
                backend.fetch.mock.calls.some(
                    ([, init]) =>
                        (decode(init.body as Uint8Array) as { name: string }).name ===
                        "GetOnlineUsers",
                ),
            ).toBe(true),
        );

        // a status known before the group is picked shows once it is
        presence("ann@acme.com", 2);
        const user = userEvent.setup();
        await pick(user, "Acme");
        await waitFor(() => expect(rowNames()).toEqual(["Ann@acme.com", "cem@acme.com"]));
        const dots = () =>
            [...document.querySelectorAll(".cx-row")].map(
                (r) => r.querySelector(".vm-avatar__status")?.getAttribute("title") ?? null,
            );
        await waitFor(() => expect(dots()).toEqual(["Online", "Status unknown"]));

        // every change follows; one the host no longer knows is unknown again
        presence("CEM@acme.com", 1);
        await waitFor(() => expect(dots()).toEqual(["Online", "Offline"]));
        presence("ann@acme.com", 0);
        await waitFor(() => expect(dots()).toEqual(["Status unknown", "Offline"]));
    });
});

// The page's event streams, stood in for: the host writes presence to every one of them.
// `presence` writes one PresenceStatus event as the host does.
function stub_presence() {
    const streams: EventTarget[] = [];
    vi.stubGlobal(
        "EventSource",
        class extends EventTarget {
            static CLOSED = 2;
            readyState = 1;
            onerror = null;
            constructor() {
                super();
                streams.push(this);
            }
            close() {}
        },
    );
    onTestFinished(() => {
        vi.unstubAllGlobals();
    });
    const presence = (address: string, state: number) => {
        const data = JSON.stringify({
            content: { address, state },
            name: "PresenceStatus",
            namespace: "https://sobamail.com/module/base/v1",
        });
        for (const s of streams) {
            s.dispatchEvent(
                new MessageEvent("{https://sobamail.com/module/base/v1}PresenceStatus", { data }),
            );
        }
    };
    return { streams, presence };
}

describe("presence", () => {
    const acme = "{00000000-0000-4000-8000-0000000000a1}";
    // the status dot of each row as shown, by its tooltip; null for none
    const dots = () =>
        [...document.querySelectorAll(".cx-row")].map(
            (r) => r.querySelector(".vm-avatar__status")?.getAttribute("title") ?? null,
        );
    const headDot = () =>
        document.querySelector(".cx-detailhead .vm-avatar__status")?.getAttribute("title") ??
        null;
    // the dot of each email in the card, by the email, lowercased
    const emailDots = () =>
        Object.fromEntries(
            [...document.querySelectorAll(".cx-maillink")].map((a) => [
                a.textContent!.toLowerCase(),
                a.previousElementSibling?.classList.contains("vm-statusdot")
                    ? a.previousElementSibling.getAttribute("title")
                    : null,
            ]),
        );

    it("dots every contact's badge, in the list and on its card, by any of its emails", async () => {
        const { presence } = stub_presence();
        put({ firstName: "Ann", lastName: "Adams", emails: ["ann@home.com", "Ann@Acme.com"] });
        put({ firstName: "Bob", lastName: "Allen", emails: ["bob@acme.com"] });
        put({ firstName: "Cher" });
        render(App);
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams", "Bob Allen", "Cher"]));
        expect(dots()).toEqual([null, null, null]);

        // online when any of a contact's emails is, else offline when any is, an email of
        // no known status notwithstanding
        presence("ann@acme.com", 1);
        presence("bob@acme.com", 2);
        await waitFor(() => expect(dots()).toEqual(["Offline", "Online", null]));
        presence("ann@home.com", 2);
        await waitFor(() => expect(dots()).toEqual(["Online", "Online", null]));

        // the card's badge too, following every change, and a dot for each email
        await open("Ann Adams");
        expect(headDot()).toBe("Online");
        const home = "ann@home.com";
        const work = "ann@acme.com";
        expect(emailDots()).toEqual({ [home]: "Online", [work]: "Offline" });
        presence(home, 1);
        await waitFor(() => expect(headDot()).toBe("Offline"));
        expect(emailDots()).toEqual({ [home]: "Offline", [work]: "Offline" });
        presence(home, 0);
        await waitFor(() =>
            expect(emailDots()).toEqual({ [home]: "Status unknown", [work]: "Offline" }),
        );
        expect(headDot()).toBe("Offline");
        presence(work, 0);
        await waitFor(() => expect(headDot()).toBeNull());
        expect(emailDots()).toEqual({ [home]: null, [work]: null });
        expect(dots()).toEqual([null, "Online", null]);
    });

    it("dots a group member's badge by its contact's emails as well", async () => {
        const { presence } = stub_presence();
        put({ firstName: "Ann", lastName: "Adams", emails: ["ann@acme.com", "ann@home.com"] });
        backend.soba.run(new SetAttrGroup({ uuid: acme, key: "name", value: "Acme" }));
        backend.soba.run(new AddGroupMember({ uuid: acme, address: "ann@acme.com" }));
        render(App);
        await waitFor(() => expect(rowNames()).toEqual(["Ann Adams"]));

        const user = userEvent.setup();
        await user.click(screen.getByRole("combobox", { name: "Contact list" }));
        await user.click(screen.getByRole("option", { name: /^Acme / }));
        await waitFor(() => expect(document.querySelector(".cx-row")).toBeTruthy());

        presence("ann@home.com", 2);
        await waitFor(() => expect(dots()).toEqual(["Online"]));
        await open("Ann Adams");
        expect(headDot()).toBe("Online");
    });
});

describe("the detail view", () => {
    it("shows labels, links emails to the composer, keeps line breaks", async () => {
        put({
            firstName: "Some",
            lastName: "One",
            emails: ["s+tag@acme.com"],
            phones: ["+90 532 555 0000"],
            notes: "one\ntwo",
            labels: { emails: { "s+tag@acme.com": "work" }, phones: { "+90 532 555 0000": "mobile" } },
        });
        render(App);
        await open("Some One");

        const link = await screen.findByRole("link", { name: "s+tag@acme.com" });
        expect(link.getAttribute("href")).toBe("mailto:s%2Btag@acme.com");
        expect(screen.getByText("Work")).toBeTruthy();
        expect(screen.getByText("Mobile")).toBeTruthy();

        const notes = screen.getByText(/one\s+two/);
        expect(notes.classList.contains("cx-inforow__value--text")).toBe(true);
        expect(notes.textContent).toBe("one\ntwo");
    });
});

describe("the form", () => {
    it("won't save an empty contact or a malformed email", async () => {
        render(App);
        const user = userEvent.setup();
        await user.click(button("New contact"));

        const create = button("Create contact");
        expect(create.disabled).toBe(true);

        await user.type(screen.getByLabelText("First name"), "Ada");
        expect(create.disabled).toBe(false);

        await user.click(button("+ add email"));
        const email = screen.getByPlaceholderText("name@example.com");
        await user.type(email, "ada@");
        expect(create.disabled).toBe(true);
        expect(screen.getByText(/don't look\s+like email addresses/)).toBeTruthy();

        await user.type(email, "example.com");
        expect(create.disabled).toBe(false);
        await user.click(create);

        await waitFor(() => expect(rowNames()).toEqual(["Ada"]));
        expect(backend.soba.sql("SELECT value FROM person_attr_multi_value")).toEqual([
            ["ada@example.com"],
        ]);
    });

    it("keeps a change made elsewhere while the contact was being edited", async () => {
        const uuid = put({ firstName: "Some", lastName: "One", jobTitle: "Developer" });
        render(App);
        const user = await open("Some One");
        await user.click(button("Edit"));
        await screen.findByText("Edit contact");

        // another replica changes the job title meanwhile
        backend.soba.run(new PutPerson({ uuid, firstName: "Some", lastName: "One", jobTitle: "Lead" }));

        const last = screen.getByLabelText("Last name");
        await user.clear(last);
        await user.type(last, "Two");
        await user.click(button("Save contact"));

        await waitFor(() => expect(rowNames()).toEqual(["Some Two"]));
        expect(get(uuid)).toMatchObject({ lastName: "Two", jobTitle: "Lead" });
    });

    // Sobamail keeps the name of a Replied contact current with the mail; an edit makes the
    // contact the user's, as editing an entry clears iscoll in the legacy address book
    it("drops the Replied tag of a contact the user edits", async () => {
        const uuid = put({ firstName: "Some", lastName: "One", tags: ["Replied", "work"] });
        render(App);
        const user = await open("Some One");
        await user.click(button("Edit"));
        await screen.findByText("Edit contact");

        const last = screen.getByLabelText("Last name");
        await user.clear(last);
        await user.type(last, "Two");
        await user.click(button("Save contact"));

        await waitFor(() => expect(rowNames()).toEqual(["Some Two"]));
        expect(get(uuid).tags).toEqual(["work"]);
    });
});

describe("deleting", () => {
    it("confirms with Enter, and the dialog doesn't come back", async () => {
        put({ firstName: "Ann", lastName: "A" });
        put({ firstName: "Bob", lastName: "B" });
        render(App);
        const user = await open("Ann A");

        await user.click(button("Delete"));
        await screen.findByRole("dialog", { name: "Delete contact" });
        await user.keyboard("{Enter}");

        await waitFor(() => expect(rowNames()).toEqual(["Bob B"]));
        await user.click(screen.getByText("Bob B", { selector: ".cx-row__name" }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("merging", () => {
    // the user deduplicates the list: any contact merges into the shown one, which takes its
    // details and loses the Replied tag (a merge is the user's edit); the merged one goes
    it("merges a picked contact into the shown one and deletes it", async () => {
        const into = put({
            firstName: "Ada",
            lastName: "Lovelace",
            emails: ["ada@example.com"],
            tags: ["Replied"],
        });
        put({ emails: ["countess@example.com"], phones: ["+44 2"], company: "Engine Co" });
        render(App);
        const user = await open("Ada Lovelace");

        await user.click(button("Merge…"));
        const dialog = await screen.findByRole("dialog", { name: "Merge contacts" });
        await user.click(
            await within(dialog).findByText("countess@example.com", {
                selector: ".cx-importrow__name",
            }),
        );
        await user.click(within(dialog).getByRole("button", { name: "Merge" }));

        await waitFor(() => expect(rowNames()).toEqual(["Ada Lovelace"]));
        expect(get(into)).toMatchObject({
            firstName: "Ada",
            lastName: "Lovelace",
            emails: ["ada@example.com", "countess@example.com"],
            phones: ["+44 2"],
            company: "Engine Co",
            tags: [],
        });
        expect(backend.soba.sql("SELECT count(*) FROM person")).toEqual([[1]]);
    });
});

describe("launch fragments", () => {
    const launch = (fragment: string) => history.replaceState(null, "", "/#" + fragment);

    it("person/show shows the card holding the address, and leaves the url", async () => {
        put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        launch("person/show?email=s@acme.com&name=Some%20One");
        render(App);

        await waitFor(() => expect(detailName()).toContain("Some One"));
        expect(location.hash).toBe("");
    });

    it("person/show under another name shows the card and suggests that name", async () => {
        const uuid = put({
            firstName: "Some",
            lastName: "One",
            emails: ["s@acme.com"],
            jobTitle: "Lead",
            tags: ["Replied", "work"],
        });
        launch("person/show?email=s@acme.com&name=%22Other%20Name%22");
        render(App);

        const hint = await screen.findByRole("status", { name: "Name suggestion" });
        expect(detailName()).toContain("Some One");
        expect(hint.textContent).toContain("Other Name");
        expect(screen.queryByText("Edit contact")).toBeNull();

        // taking it renames the contact alone, and makes it the user's: Replied goes
        await userEvent.setup().click(within(hint).getByRole("button", { name: "Use this name" }));
        await waitFor(() => expect(detailName()).toContain("Other Name"));
        expect(get(uuid)).toMatchObject({
            firstName: "Other",
            lastName: "Name",
            emails: ["s@acme.com"],
            jobTitle: "Lead",
            tags: ["work"],
        });
        expect(screen.queryByRole("status", { name: "Name suggestion" })).toBeNull();
    });

    it("person/show's name suggestion goes on Dismiss and with another contact", async () => {
        const uuid = put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        put({ firstName: "Ann", lastName: "A" });
        launch("person/show?email=s@acme.com&name=Other%20Name");
        render(App);

        const user = userEvent.setup();
        const hint = await screen.findByRole("status", { name: "Name suggestion" });
        await user.click(within(hint).getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByRole("status", { name: "Name suggestion" })).toBeNull();
        expect(get(uuid)).toMatchObject({ firstName: "Some", lastName: "One" });

        launch("person/show?email=s@acme.com&name=Other%20Name");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        await screen.findByRole("status", { name: "Name suggestion" });
        await user.click(screen.getByText("Ann A", { selector: ".cx-row__name" }));
        expect(screen.queryByRole("status", { name: "Name suggestion" })).toBeNull();
    });

    it("person/show for an unknown address shows it and suggests adding it", async () => {
        launch("person/show?email=new@acme.com&name=New%20Person");
        render(App);

        const hint = await screen.findByRole("status", { name: "Add suggestion" });
        expect(detailName()).toContain("New Person");
        expect(detailName()).toContain("Not in your contacts");
        expect(screen.getByText("new@acme.com", { selector: "a" })).toBeTruthy();
        expect(screen.queryByText("New contact", { selector: "div" })).toBeNull();

        await userEvent
            .setup()
            .click(within(hint).getByRole("button", { name: "Add to contacts" }));
        await screen.findByText("New contact", { selector: "div" });
        expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("New");
        expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Person");
        expect((screen.getByPlaceholderText("name@example.com") as HTMLInputElement).value).toBe(
            "new@acme.com",
        );
    });

    it("person/new opens an empty entry; an invalid fragment is dropped", async () => {
        launch("person/new");
        const { unmount } = render(App);
        await screen.findByText("New contact", { selector: "div" });
        expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("");
        unmount();

        launch("person/show?name=Nobody");
        render(App);
        await waitFor(() => expect(location.hash).toBe(""));
        expect(screen.queryByText("New contact", { selector: "div" })).toBeNull();
    });

    const hidden = (selector: string) =>
        document.querySelector(selector)!.classList.contains("cx-hidden");

    it("pane/left shows the list alone, keeps the url, and pane/right brings the rest", async () => {
        put({ firstName: "Some", lastName: "One" });
        launch("pane/left");
        render(App);

        await waitFor(() => expect(rowNames()).toEqual(["Some One"]));
        expect(hidden(".cx-listpane")).toBe(false);
        expect(hidden(".cx-detail")).toBe(true);
        expect(hidden(".cx-toolbar")).toBe(true);
        expect(location.hash).toBe("#pane/left");

        location.hash = "#pane/left,right";
        await waitFor(() => expect(hidden(".cx-detail")).toBe(false));
        expect(hidden(".cx-toolbar")).toBe(false);
        expect(hidden(".cx-listpane")).toBe(false);
    });

    it("shows every pane without an pane/ fragment", async () => {
        render(App);
        for (const pane of [".cx-toolbar", ".cx-listpane", ".cx-detail"]) {
            expect(hidden(pane), pane).toBe(false);
        }
    });

    it("under pane/left a click opens the full app on the card, not a card here", async () => {
        const uuid = put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        const opened = vi.fn();
        window.open = opened;
        launch("pane/left");
        render(App);

        await open("Some One");
        expect(opened).toHaveBeenCalledTimes(1);
        expect(opened).toHaveBeenCalledWith(`#person/show?uuid=${encodeURIComponent(uuid)}`, "_blank");
        expect(detailName()).toBe("");
        expect(location.hash).toBe("#pane/left");
    });

    it("person/show?uuid shows that card, and leaves the url", async () => {
        put({ firstName: "Other", lastName: "Card", emails: ["o@acme.com"] });
        const uuid = put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        launch(`person/show?uuid=${encodeURIComponent(uuid)}`);
        render(App);

        await waitFor(() => expect(detailName()).toContain("Some One"));
        expect(location.hash).toBe("");
    });
});

describe("export", () => {
    it("mails the selected contact's vCard to the addresses given", async () => {
        put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        render(App);
        const user = await open("Some One");

        await user.click(button("Export"));
        const dialog = await screen.findByRole("dialog", { name: "Export as vCard" });
        const send = within(dialog).getByRole("button", { name: "Send" }) as HTMLButtonElement;
        expect(send.disabled).toBe(true);

        await user.type(within(dialog).getByLabelText("Send by email to"), "x@example.com, y@example.com");
        await user.click(send);
        await within(dialog).findByText("Sent to x@example.com, y@example.com.");

        expect(backend.soba.sent).toHaveLength(1);
        const m = backend.soba.sent[0] as FakeMessage;
        expect(m.to).toEqual([{ address: "x@example.com" }, { address: "y@example.com" }]);
        expect(m.subject).toBe("Contact: Some One");
        const { name, blobs } = m.attachments[0].init;
        expect(name).toBe("Some One.vcf");
        expect(new TextDecoder().decode(blobs[0])).toContain("FN:Some One");
    });
});

describe("import", () => {
    it("lists the cards, leaves known ones out, and imports the rest with progress", async () => {
        put({ firstName: "Old", emails: ["old@example.com"] });
        render(App);
        await waitFor(() => expect(rowNames()).toEqual(["Old"]));

        const vcf = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:Old Again",
            "EMAIL:old@example.com",
            "END:VCARD",
            "BEGIN:VCARD",
            "VERSION:3.0",
            "N:Person;New;;;",
            "EMAIL;TYPE=work:new@example.com",
            "END:VCARD",
            "",
        ].join("\r\n");
        const user = userEvent.setup();
        await user.upload(
            screen.getByLabelText("vCard file to import"),
            new File([vcf], "contacts.vcf", { type: "text/vcard" }),
        );

        const dialog = await screen.findByRole("dialog", { name: "Import contacts" });
        expect(within(dialog).getByText("already in your contacts")).toBeTruthy();
        const boxes = within(dialog).getAllByRole("checkbox") as HTMLInputElement[];
        expect(boxes.map((b) => b.checked)).toEqual([false, true]);

        await user.click(within(dialog).getByRole("button", { name: "Import 1 contact" }));
        await within(dialog).findByText("Imported 1 of 1.");
        expect((within(dialog).getByLabelText("Import progress") as HTMLProgressElement).value).toBe(1);

        await user.click(within(dialog).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(rowNames()).toEqual(["Old", "New Person"]));
        expect(backend.soba.sql("SELECT label FROM person_attr_label")).toEqual([["work"]]);
    });
});
