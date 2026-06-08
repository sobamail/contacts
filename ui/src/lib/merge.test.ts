// merge_people: what a contact becomes when the user merges another one into it.

import { describe, expect, it } from "vitest";
import { Person } from "$module/contacts/v1";
import { merge_people } from "$lib/merge";

describe("merge_people", () => {
    it("keeps the first contact's fields and fills its blanks from the second", () => {
        const merged = merge_people(
            new Person({ uuid: "{a}", firstName: "Ada", jobTitle: "Countess" }),
            new Person({
                uuid: "{b}",
                firstName: "A.",
                lastName: "Lovelace",
                jobTitle: "Analyst",
                company: "Engine Co",
                address: "London",
            }),
        );

        // the name is one piece: the first contact's, though it has no last name
        expect(merged).toMatchObject({
            uuid: "{a}",
            firstName: "Ada",
            lastName: "",
            jobTitle: "Countess",
            company: "Engine Co",
            address: "London",
        });
    });

    it("takes the second contact's name when the first has none", () => {
        const merged = merge_people(
            new Person({ emails: ["ada@example.com"] }),
            new Person({ firstName: "Ada", lastName: "Lovelace" }),
        );
        expect(merged).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    });

    it("unites the lists, an email's case ignored, and keeps both notes", () => {
        const merged = merge_people(
            new Person({
                emails: ["ada@example.com"],
                phones: ["+44 1"],
                tags: ["work"],
                notes: "met in 1833",
            }),
            new Person({
                emails: ["Ada@Example.com", "countess@example.com"],
                phones: ["+44 1", "+44 2"],
                tags: ["work", "maths"],
                notes: "likes engines",
            }),
        );

        expect(merged.emails).toEqual(["ada@example.com", "countess@example.com"]);
        expect(merged.phones).toEqual(["+44 1", "+44 2"]);
        expect(merged.tags).toEqual(["work", "maths"]);
        expect(merged.notes).toBe("met in 1833\n\nlikes engines");
    });

    it("keeps the first contact's labels and takes the second's for the rest", () => {
        const merged = merge_people(
            new Person({
                emails: ["ada@example.com"],
                labels: { emails: { "ada@example.com": "home" } },
            }),
            new Person({
                emails: ["ADA@example.com", "countess@example.com"],
                phones: ["+44 2"],
                labels: {
                    emails: { "ADA@example.com": "work", "countess@example.com": "work" },
                    phones: { "+44 2": "mobile" },
                },
            }),
        );

        expect(merged.labels).toEqual({
            emails: { "ada@example.com": "home", "countess@example.com": "work" },
            phones: { "+44 2": "mobile" },
        });
    });

    // a merge is the user's edit: Sobamail stops renaming the contact after the mail
    it("drops the Replied tag", () => {
        const merged = merge_people(
            new Person({ firstName: "Ada", tags: ["Replied"] }),
            new Person({ tags: ["Replied", "work"] }),
        );
        expect(merged.tags).toEqual(["work"]);
    });
});
