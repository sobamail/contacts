// @vitest-environment jsdom

// App.svelte against the real module on the stand-in runtime (test/backend.ts): the
// list, the detail view, the form, deleting, launch fragments, export and import.

import { render, screen, waitFor, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    GetPerson,
    Person,
    PutPerson,
    PutPersonResponse,
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

    it("person/show under another name opens an edit with that name", async () => {
        put({ firstName: "Some", lastName: "One", emails: ["s@acme.com"] });
        launch("person/show?email=s@acme.com&name=%22Other%20Name%22");
        render(App);

        await screen.findByText("Edit contact");
        expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Other");
        expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Name");
    });

    it("person/show for an unknown address opens a pre-filled new entry", async () => {
        launch("person/show?email=new@acme.com&name=New%20Person");
        render(App);

        await screen.findByText("New contact", { selector: "div" });
        expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("New");
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
