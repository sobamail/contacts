// The contacts module's request handlers (sobamail.com/module/contacts/v1.mjs),
// run on a stand-in runtime with a real SQLite underneath.

import { beforeEach, describe, expect, it } from "vitest";
import {
    AddGroup,
    AddGroupMember,
    AddPerson,
    AddPersonAttr,
    AddPersonAttrValue,
    DelGroup,
    DelGroupMember,
    DeletePerson,
    GetPeople,
    GetPeopleResponse,
    GetPerson,
    MalformedObject,
    Person,
    PutPerson,
    PutPersonResponse,
    SetAttrGroup,
    SetPersonAttr,
    SetPersonAttrLabel,
    UnsetAttrGroup,
    mailed_object,
    namespace,
    type PersonData,
} from "$module/contacts/v1";
import { ACCOUNT, install_fake_soba, type FakeSoba } from "../test/soba";

let soba: FakeSoba;

beforeEach(async () => {
    soba = await install_fake_soba();
});

const put = (content: ConstructorParameters<typeof PutPerson>[0]) =>
    soba.run<PutPersonResponse>(new PutPerson(content))?.uuid;
const get = (uuid: string) => soba.run<Person>(new GetPerson({ uuid }))!;
const list = (content: ConstructorParameters<typeof GetPeople>[0] = {}) =>
    soba.run<GetPeopleResponse>(new GetPeople(content))!.data;
const count = (table: string) => soba.sql(`SELECT count(*) FROM ${table}`)[0][0];

describe("constructors", () => {
    it("reject content without its required fields as malformed", () => {
        const person = "{00000000-0000-4000-8000-000000000001}";
        for (const make of [
            () => new AddPerson({}),
            () => new SetPersonAttr({ key: "firstName" }),
            () => new SetPersonAttr({ person }),
            () => new AddPersonAttr({ person }),
            () => new AddPersonAttrValue({ key: "emails" }),
            () => new AddPersonAttrValue({ person, value: "a@example.com" }),
            () => new DeletePerson({} as { uuid: string }),
            () => new SetPersonAttrLabel({ person, key: "emails", value: "a@example.com" }),
        ]) {
            expect(make).toThrow(MalformedObject);
            expect(make).toThrow(/^Missing Person[A-Za-z]*\.[a-z]+$/);
        }
    });
});

describe("PutPerson", () => {
    it("creates a person, trimming values and dropping blank and repeated list items", () => {
        const uuid = put({
            firstName: " Some ",
            lastName: "One",
            emails: ["some@example.com", " ", "some@example.com", " other@example.com"],
            tags: ["work"],
        })!;

        expect(get(uuid)).toMatchObject({
            uuid,
            firstName: "Some",
            lastName: "One",
            jobTitle: "",
            emails: ["other@example.com", "some@example.com"],
            phones: [],
            tags: ["work"],
        });
    });

    it("refuses to create an empty person", () => {
        expect(put({ firstName: " ", emails: ["", " "] })).toBeUndefined();
        expect(count("person")).toBe(0);
    });

    it("deletes a cleared field and replaces a changed list", () => {
        const uuid = put({
            firstName: "Some",
            lastName: "One",
            emails: ["a@example.com", "b@example.com"],
        })!;

        put({ uuid, firstName: "Some", emails: ["b@example.com", "c@example.com"] });

        expect(get(uuid)).toMatchObject({
            firstName: "Some",
            lastName: "",
            emails: ["b@example.com", "c@example.com"],
        });
        expect(count("person_attr_single")).toBe(1);
        expect(count("person_attr_multi_value")).toBe(2);
    });

    it("drops a list's container when the list is emptied", () => {
        const uuid = put({ firstName: "Some", phones: ["+90 212 555 0000"] })!;
        put({ uuid, firstName: "Some", phones: [] });

        expect(get(uuid).phones).toEqual([]);
        expect(count("person_attr_multi")).toBe(0);
    });
});

describe("PutPerson with the form's base", () => {
    // `edit` is what the form loaded; `elsewhere` lands before the form is saved,
    // the way a change synced in from another replica would.
    function edit(
        initial: Partial<PersonData>,
        elsewhere: Partial<PersonData>,
        change: Partial<PersonData>,
    ) {
        const uuid = put(initial)!;
        const base: PersonData = { ...get(uuid) };
        put({ ...get(uuid), ...elsewhere });
        put({ ...base, ...change, base });
        return get(uuid);
    }

    it("keeps a field changed elsewhere that the user left alone", () => {
        expect(
            edit(
                { firstName: "Some", lastName: "One", jobTitle: "Developer" },
                { jobTitle: "Lead" },
                { lastName: "Two" },
            ),
        ).toMatchObject({ firstName: "Some", lastName: "Two", jobTitle: "Lead" });
    });

    it("lets the user's change win over one made elsewhere to the same field", () => {
        expect(
            edit({ firstName: "Some", jobTitle: "Developer" }, { jobTitle: "Lead" }, {
                jobTitle: "Manager",
            }).jobTitle,
        ).toBe("Manager");
        expect(
            edit({ firstName: "Some", jobTitle: "Developer" }, { jobTitle: "Lead" }, {
                jobTitle: "",
            }).jobTitle,
        ).toBe("");
    });

    it("keeps list items added elsewhere and drops the ones the user removed", () => {
        expect(
            edit(
                { firstName: "Some", emails: ["a@example.com", "b@example.com"] },
                { emails: ["a@example.com", "b@example.com", "c@example.com"] },
                { emails: ["a@example.com", "d@example.com"] },
            ).emails,
        ).toEqual(["a@example.com", "c@example.com", "d@example.com"]);
    });

    it("leaves a list changed elsewhere alone when the user didn't touch it", () => {
        expect(
            edit(
                { firstName: "Some", tags: ["work"] },
                { tags: ["work", "golf"] },
                { firstName: "Somebody" },
            ),
        ).toMatchObject({ firstName: "Somebody", tags: ["work", "golf"] });
    });

    it("ignores a base sent for a new person", () => {
        const uuid = put({ firstName: "Some", base: { firstName: "Some" } })!;
        expect(get(uuid).firstName).toBe("Some");
    });

    // Sobamail's send-time collect renames a person it tagged Replied with the name and a base of
    // the old name alone, every other field blank (amp-librepl contacts::add_contact_to_app_txn):
    // the name changes, nothing else does
    it("changes the name alone when the base carries only the old name", () => {
        const uuid = put({
            firstName: "Old",
            lastName: "Name",
            company: "Acme",
            emails: ["o@example.com"],
            tags: ["Replied", "work"],
            labels: { emails: { "o@example.com": "work" } },
        })!;

        put({
            uuid,
            firstName: "New",
            lastName: "",
            jobTitle: "",
            company: "",
            emails: [],
            phones: [],
            tags: [],
            address: "",
            notes: "",
            base: { firstName: "Old", lastName: "Name" },
        });

        expect(get(uuid)).toMatchObject({
            firstName: "New",
            lastName: "",
            company: "Acme",
            emails: ["o@example.com"],
            tags: ["Replied", "work"],
            labels: { emails: { "o@example.com": "work" } },
        });
    });
});

describe("labels", () => {
    const work = "a@example.com";
    const home = "b@example.com";
    const mobile = "+90 532 555 0000";

    it("label emails and phones, and come back with the person and the list", () => {
        const uuid = put({
            firstName: "Some",
            emails: [work, home],
            phones: [mobile],
            labels: { emails: { [work]: "work", [home]: " " }, phones: { [mobile]: " mobile " } },
        })!;

        const labels = { emails: { [work]: "work" }, phones: { [mobile]: "mobile" } };
        expect(get(uuid).labels).toEqual(labels);
        expect(list()[0].labels).toEqual(labels);
    });

    it("go with the value: a removed value loses its label, a kept one keeps its row", () => {
        const uuid = put({
            firstName: "Some",
            emails: [work, home],
            labels: { emails: { [work]: "work", [home]: "home" } },
        })!;
        const kept = soba.sql("SELECT id FROM person_attr_label WHERE value = ?", work);

        put({ uuid, firstName: "Some", emails: [work], labels: { emails: { [work]: "work" } } });

        expect(get(uuid).labels).toEqual({ emails: { [work]: "work" } });
        expect(soba.sql("SELECT id FROM person_attr_label")).toEqual(kept);
    });

    it("change or clear without the list being rewritten", () => {
        const uuid = put({
            firstName: "Some",
            emails: [work, home],
            labels: { emails: { [work]: "work", [home]: "home" } },
        })!;
        const values = soba.sql("SELECT id FROM person_attr_multi_value");

        put({
            uuid,
            firstName: "Some",
            emails: [work, home],
            labels: { emails: { [work]: "other" } },
        });

        expect(get(uuid).labels).toEqual({ emails: { [work]: "other" } });
        expect(soba.sql("SELECT id FROM person_attr_multi_value")).toEqual(values);
    });

    it("with the form's base, keep a label changed elsewhere that the user left alone", () => {
        const uuid = put({
            firstName: "Some",
            emails: [work, home],
            labels: { emails: { [work]: "work", [home]: "home" } },
        })!;
        const base = get(uuid);
        // elsewhere: work becomes "other", and a phone with a label is added
        put({
            ...get(uuid),
            phones: [mobile],
            labels: {
                emails: { [work]: "other", [home]: "home" },
                phones: { [mobile]: "mobile" },
            },
        });
        // the user relabels home only
        put({
            ...base,
            labels: { emails: { [work]: "work", [home]: "other" } },
            base,
        });

        expect(get(uuid).labels).toEqual({
            emails: { [work]: "other", [home]: "other" },
            phones: { [mobile]: "mobile" },
        });
    });

    it("are dropped with the person", () => {
        const uuid = put({ firstName: "Some", emails: [work], labels: { emails: { [work]: "w" } } })!;
        soba.run(new DeletePerson({ uuid }));
        expect(count("person_attr_label")).toBe(0);
    });
});

describe("DeletePerson", () => {
    it("removes the person with all of its attributes", () => {
        const uuid = put({ firstName: "Some", emails: ["a@example.com"], tags: ["x"] })!;
        soba.run(new DeletePerson({ uuid }));

        for (const table of [
            "person",
            "person_attr_single",
            "person_attr_multi",
            "person_attr_multi_value",
        ]) {
            expect(count(table), table).toBe(0);
        }
    });

    it("ignores a person that doesn't exist instead of failing the find", () => {
        put({ firstName: "Some" });
        soba.run(new DeletePerson({ uuid: "{00000000-0000-4000-8000-0000000000ff}" }));
        expect(count("person")).toBe(1);
    });
});

describe("groups", () => {
    const group = "{00000000-0000-4000-8000-0000000000a1}";
    const attrs = () =>
        soba.sql("SELECT key, value FROM group_attr WHERE grp = ? ORDER BY key", group);
    const members = () =>
        soba
            .sql("SELECT address FROM group_member WHERE grp = ? ORDER BY address", group)
            .map((r) => r[0]);

    it("AddGroup lands the group, once however often it comes", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new AddGroup({ uuid: group }));
        expect(soba.sql("SELECT uuid FROM grp")).toEqual([[group]]);
    });

    it("SetAttrGroup writes name and type, and a second write replaces", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new SetAttrGroup({ uuid: group, key: "type", value: "company" }));
        soba.run(new SetAttrGroup({ uuid: group, key: "name", value: "Old" }));
        soba.run(new SetAttrGroup({ uuid: group, key: "name", value: "New" }));
        expect(attrs()).toEqual([
            ["name", "New"],
            ["type", "company"],
        ]);
    });

    it("UnsetAttrGroup removes one attribute and ignores a missing one", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new SetAttrGroup({ uuid: group, key: "type", value: "company" }));
        soba.run(new SetAttrGroup({ uuid: group, key: "name", value: "Acme" }));
        soba.run(new UnsetAttrGroup({ uuid: group, key: "name" }));
        soba.run(new UnsetAttrGroup({ uuid: group, key: "name" }));
        expect(attrs()).toEqual([["type", "company"]]);
    });

    it("AddGroupMember twice for one address is one row", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new AddGroupMember({ uuid: group, address: "a@example.com" }));
        soba.run(new AddGroupMember({ uuid: group, address: " a@example.com " }));
        soba.run(new AddGroupMember({ uuid: group, address: ACCOUNT }));
        expect(members()).toEqual(["a@example.com", ACCOUNT]);
    });

    it("AddGroupMember and SetAttrGroup create a group they arrive before", () => {
        soba.run(new AddGroupMember({ uuid: group, address: "a@example.com" }));
        soba.run(new SetAttrGroup({ uuid: group, key: "type", value: "company" }));
        expect(count("grp")).toBe(1);
        expect(members()).toEqual(["a@example.com"]);
    });

    it("DelGroupMember removes the member and ignores a missing one", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new AddGroupMember({ uuid: group, address: "a@example.com" }));
        soba.run(new AddGroupMember({ uuid: group, address: "b@example.com" }));
        soba.run(new DelGroupMember({ uuid: group, address: "a@example.com" }));
        soba.run(new DelGroupMember({ uuid: group, address: "a@example.com" }));
        expect(members()).toEqual(["b@example.com"]);
    });

    it("DelGroup empties everything and ignores a missing group", () => {
        soba.run(new AddGroup({ uuid: group }));
        soba.run(new SetAttrGroup({ uuid: group, key: "type", value: "company" }));
        soba.run(new AddGroupMember({ uuid: group, address: "a@example.com" }));
        soba.run(new DelGroup({ uuid: group }));
        soba.run(new DelGroup({ uuid: group }));
        for (const table of ["grp", "group_attr", "group_member"]) {
            expect(count(table), table).toBe(0);
        }
    });

    it("reject content without its required fields as malformed", () => {
        for (const make of [
            () => new AddGroup({}),
            () => new DelGroup({}),
            () => new SetAttrGroup({ uuid: group }),
            () => new SetAttrGroup({ key: "name" }),
            () => new UnsetAttrGroup({ uuid: group }),
            () => new AddGroupMember({ uuid: group, address: " " }),
            () => new DelGroupMember({ address: "a@example.com" }),
        ]) {
            expect(make).toThrow(MalformedObject);
            expect(make).toThrow(/^Missing Group[A-Za-z]*\.[a-z]+$/);
        }
    });

    it("a replayed group object passes ungated", () => {
        // a task or its replay reaches the handler without mailed_object(): nothing about
        // the sender is asked
        soba.run(new AddGroupMember({ uuid: group, address: "a@example.com" }));
        expect(members()).toEqual(["a@example.com"]);
    });
});

describe("mailed objects", () => {
    const NS_BASE = "https://sobamail.com/module/base/v1";
    // the deployment's apps account, one address for every recipient whatever its domain
    const APPS = "apps@api.sobamail.com";
    const add_group = {
        namespace,
        name: "AddGroup",
        content: { uuid: "{00000000-0000-4000-8000-0000000000a1}" },
    };
    const bare = (object: unknown) => ({ bodyObject: { content: object } });
    const envelope = (content: Record<string, unknown>) =>
        bare({ namespace: NS_BASE, name: "Envelope", content });
    const signed = (object: unknown, sender = APPS, signature: unknown = new Uint8Array([1, 2, 3])) =>
        envelope({ sender, signature, content: object });

    it("a group object signed by the deployment's apps account is taken", () => {
        // the stand-in account is on example.com: the apps account is the same for every domain
        expect(ACCOUNT.endsWith("@example.com")).toBe(true);
        expect(mailed_object(signed(add_group))).toEqual(add_group);
        expect(mailed_object(signed(add_group, "Apps@Api.Sobamail.COM"))).toEqual(add_group);
        for (const name of [
            "AddGroup",
            "DelGroup",
            "SetAttrGroup",
            "UnsetAttrGroup",
            "AddGroupMember",
            "DelGroupMember",
        ]) {
            const object = { ...add_group, name };
            expect(mailed_object(signed(object)), name).toEqual(object);
        }
    });

    it("a group object from another sender is refused", () => {
        for (const sender of [
            "apps@example.com",
            "someone@example.com",
            "someone@api.sobamail.com",
            "apps@sobamail.com",
            "apps@sub.api.sobamail.com",
            "",
        ]) {
            expect(mailed_object(signed(add_group, sender)), sender).toBeNull();
        }
    });

    it("an unsigned group object is refused", () => {
        expect(mailed_object(bare(add_group))).toBeNull();
        expect(mailed_object(envelope({ sender: APPS, content: add_group }))).toBeNull();
        for (const signature of [null, "", new Uint8Array(0), new ArrayBuffer(0)]) {
            expect(mailed_object(signed(add_group, APPS, signature))).toBeNull();
        }
    });

    it("a mailed PutPerson is refused", () => {
        const put_person = { namespace, name: "PutPerson", content: { firstName: "Some" } };
        expect(mailed_object(signed(put_person))).toBeNull();
        for (const name of ["Group", "GroupAttr", "GroupMember", "DeletePerson"]) {
            expect(mailed_object(signed({ ...add_group, name })), name).toBeNull();
        }
        expect(mailed_object(signed({ ...add_group, namespace: NS_BASE }))).toBeNull();
    });

    it("a message without a structured body is refused", () => {
        for (const message of [{}, { bodyObject: {} }, bare(null), signed(null), signed("x")]) {
            expect(mailed_object(message)).toBeNull();
        }
    });
});

describe("GetPerson", () => {
    it("sorts emails by address, ignoring case", () => {
        const uuid = put({
            firstName: "Some",
            emails: ["b@example.com", "C@example.com", "a@example.com"],
        })!;
        expect(get(uuid).emails).toEqual(["a@example.com", "b@example.com", "C@example.com"]);
    });
});

describe("GetPeople", () => {
    it("returns complete people for a match on any one attribute", () => {
        put({ firstName: "Some", lastName: "One", company: "Acme", emails: ["s@acme.com"] });
        put({ firstName: "Other", lastName: "Two", company: "Initech" });

        expect(list({ filter: "acme" })).toEqual([
            expect.objectContaining({
                firstName: "Some",
                lastName: "One",
                company: "Acme",
                emails: ["s@acme.com"],
            }),
        ]);
    });

    it("ignores case and accents, Turkish dotted and dotless i included", () => {
        put({ firstName: "Şahin", lastName: "Yılmaz" });
        put({ firstName: "Çağrı", lastName: "Işık" });

        const names = (filter: string) => list({ filter }).map((p) => p.firstName);
        expect(names("sahin")).toEqual(["Şahin"]);
        expect(names("ŞAHİN")).toEqual(["Şahin"]);
        expect(names("yilmaz")).toEqual(["Şahin"]);
        expect(names("cagri")).toEqual(["Çağrı"]);
        expect(names("ISIK")).toEqual(["Çağrı"]);
    });

    it("takes % and _ literally and matches list items one by one", () => {
        put({ firstName: "Pure", company: "100% Pure" });
        put({ firstName: "Two", emails: ["a@example.com", "b@example.com"] });

        expect(list({ filter: "%" }).map((p) => p.firstName)).toEqual(["Pure"]);
        expect(list({ filter: "_" })).toEqual([]);
        expect(list({ filter: '","' })).toEqual([]);
    });

    it("lists people without any attributes", () => {
        put({ firstName: "Some" });
        soba.sql("INSERT INTO person (uuid) VALUES (?)", "{00000000-0000-4000-8000-0000000000ff}");

        expect(list()).toHaveLength(2);
        expect(list()).toContainEqual(
            expect.objectContaining({
                uuid: "{00000000-0000-4000-8000-0000000000ff}",
                firstName: "",
                emails: [],
            }),
        );
    });

    it("orders by last name, then first name, people without a name last", () => {
        put({ firstName: "Zed", lastName: "Adams" });
        put({ company: "No Name Inc" });
        put({ firstName: "Bob", lastName: "Allen" });
        put({ firstName: "Cher" });
        put({ firstName: "Ann", lastName: "adams" });

        expect(list().map((p) => `${p.firstName} ${p.lastName}`.trim() || p.company)).toEqual(
            ["Ann adams", "Zed Adams", "Bob Allen", "Cher", "No Name Inc"],
        );
    });

    it("orders ignoring accents, Turkish letters with their base letter", () => {
        put({ firstName: "A", lastName: "Tan" });
        put({ firstName: "B", lastName: "Şimşek" });
        put({ firstName: "C", lastName: "Sarı" });
        put({ firstName: "D", lastName: "Öz" });

        expect(list().map((p) => p.lastName)).toEqual(["Öz", "Sarı", "Şimşek", "Tan"]);
    });

    it("slices pages, searched or not, out of that order", () => {
        for (const name of ["Delta", "Alpha", "Echo", "Charlie", "Bravo"]) {
            put({ firstName: "Match", lastName: name });
        }
        put({ firstName: "Other", lastName: "Aaron" });

        const last_names = (content: ConstructorParameters<typeof GetPeople>[0]) =>
            list(content).map((p) => p.lastName);
        expect(last_names({ limit: 2, offset: 0 })).toEqual(["Aaron", "Alpha"]);
        expect(last_names({ limit: 2, offset: 2 })).toEqual(["Bravo", "Charlie"]);
        expect(last_names({ filter: "match", limit: 2, offset: 0 })).toEqual([
            "Alpha",
            "Bravo",
        ]);
        expect(last_names({ filter: "match", limit: 2, offset: 4 })).toEqual(["Echo"]);
    });

    it("pages after filtering", () => {
        for (let i = 0; i < 3; i++) put({ firstName: `Match ${i}` });
        for (let i = 0; i < 3; i++) put({ firstName: `Other ${i}` });

        expect(list({ filter: "match", limit: 2, offset: 0 })).toHaveLength(2);
        expect(list({ filter: "match", limit: 2, offset: 2 })).toHaveLength(1);
        expect(list({ limit: 4, offset: 4 })).toHaveLength(2);
    });
});
