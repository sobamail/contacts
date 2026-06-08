import { describe, expect, it } from "vitest";
import { Person } from "$module/contacts/v1";
import { parse_vcards, vcard, vcard_filename } from "./vcard";

const CRLF = String.fromCharCode(13, 10);

// the card's content lines, folding undone
const unfold = (text: string) => text.split(CRLF + " ").join("").split(CRLF).filter(Boolean);

const person = (init: Partial<Person>) =>
    new Person({ uuid: "{00000000-0000-4000-8000-000000000001}", ...init });

describe("vcard", () => {
    it("writes the fields a phone or mail client imports", () => {
        const text = vcard([
            person({
                firstName: "Some",
                lastName: "One",
                company: "Acme",
                jobTitle: "Lead",
                emails: ["s@acme.com", "s@home.org"],
                phones: ["+90 532 555 0000", "+90 212 555 0000"],
                tags: ["work", "golf"],
                labels: {
                    emails: { "s@acme.com": "work" },
                    phones: { "+90 532 555 0000": "mobile", "+90 212 555 0000": "other" },
                },
            }),
        ]);

        expect(text.endsWith(CRLF)).toBe(true);
        expect(unfold(text)).toEqual([
            "BEGIN:VCARD",
            "VERSION:3.0",
            "UID:urn:uuid:00000000-0000-4000-8000-000000000001",
            "N:One;Some;;;",
            "FN:Some One",
            "ORG:Acme",
            "TITLE:Lead",
            "EMAIL;TYPE=INTERNET,WORK:s@acme.com",
            "EMAIL;TYPE=INTERNET:s@home.org",
            "TEL;TYPE=CELL:+90 532 555 0000",
            "TEL:+90 212 555 0000",
            "CATEGORIES:work,golf",
            "END:VCARD",
        ]);
    });

    it("escapes backslashes, line breaks, commas and semicolons", () => {
        const lines = unfold(
            vcard([
                person({
                    firstName: "A;B",
                    company: "X, Y",
                    address: "Street 1\nIstanbul",
                    notes: "C:\\temp",
                    tags: ["a,b"],
                }),
            ]),
        );
        expect(lines).toContain("N:;A\\;B;;;");
        expect(lines).toContain("ORG:X\\, Y");
        expect(lines).toContain("ADR:;;Street 1\\nIstanbul;;;;");
        expect(lines).toContain("NOTE:C:\\\\temp");
        expect(lines).toContain("CATEGORIES:a\\,b");
    });

    it("names a card without a name after its company, then its first email", () => {
        expect(unfold(vcard([person({ company: "Acme" })]))).toContain("FN:Acme");
        expect(unfold(vcard([person({ emails: ["a@b.com"] })]))).toContain("FN:a@b.com");
    });

    it("ignores a label that isn't a vCard type", () => {
        const p = person({
            firstName: "X",
            phones: ["1"],
            labels: { phones: { "1": "constructor" } },
        });
        expect(unfold(vcard([p]))).toContain("TEL:1");
    });

    it("folds lines at 75 octets without splitting a character", () => {
        const notes = "Şükrü Çağlayan ".repeat(12);
        const text = vcard([person({ firstName: "X", notes })]);
        const utf8 = new TextEncoder();

        for (const line of text.split(CRLF).filter(Boolean)) {
            expect(utf8.encode(line).length).toBeLessThanOrEqual(75);
        }
        expect(unfold(text)).toContain(`NOTE:${notes}`);
    });

    it("writes one card per person", () => {
        const text = vcard([person({ firstName: "A" }), person({ firstName: "B" })]);
        expect(unfold(text).filter((l) => l === "BEGIN:VCARD")).toHaveLength(2);
    });
});

describe("parse_vcards", () => {
    const file = (...lines: string[]) => lines.join(CRLF) + CRLF;

    it("reads back what vcard() writes", () => {
        const original = person({
            firstName: "Şükrü",
            lastName: "Çağlayan",
            company: "Acme, Inc; R&D",
            jobTitle: "Lead",
            emails: ["s@acme.com", "s@home.org"],
            phones: ["+90 532 555 0000", "+90 212 555 0000"],
            tags: ["work", "a,b"],
            address: "Street 1\nIstanbul",
            notes: "line one\nline two; with a \\ backslash",
            labels: {
                emails: { "s@acme.com": "work" },
                phones: { "+90 532 555 0000": "mobile", "+90 212 555 0000": "fax" },
            },
        });

        const { people, skipped } = parse_vcards(vcard([original]));

        expect(skipped).toBe(0);
        const { uuid: _, ...fields } = original;
        expect(people).toEqual([fields]);
    });

    it("reads vCard 2.1: bare types and quoted-printable with a charset", () => {
        const { people } = parse_vcards(
            file(
                "BEGIN:VCARD",
                "VERSION:2.1",
                "N;CHARSET=ISO-8859-9;ENCODING=QUOTED-PRINTABLE:=DEim=FEek;Ali;;;",
                "TEL;CELL;VOICE:+90 532 555 0000",
                "TEL;WORK;FAX:+90 212 555 0001",
                "NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C5=9Eu bir not, =",
                "uzun bir not",
                "END:VCARD",
            ),
        );

        expect(people).toEqual([
            expect.objectContaining({
                firstName: "Ali",
                lastName: "Şimşek",
                phones: ["+90 532 555 0000", "+90 212 555 0001"],
                notes: "Şu bir not, uzun bir not",
                labels: { phones: { "+90 532 555 0000": "mobile", "+90 212 555 0001": "fax" } },
            }),
        ]);
    });

    it("reads vCard 4.0: groups, quoted types, tel: values, a name from FN", () => {
        const { people } = parse_vcards(
            "BEGIN:VCARD\nVERSION:4.0\nFN:Jean Claude Van Damme\n" +
                "item1.EMAIL;TYPE=work:jcvd@example.com\n" +
                'TEL;VALUE=uri;TYPE="voice,cell":tel:+1-555-0100\n' +
                "ADR;TYPE=home:;Apt 4;1 Main St;Springfield;IL;62701;USA\n" +
                "ORG:Acme;Stunts\nEND:VCARD\n",
        );

        expect(people).toEqual([
            expect.objectContaining({
                firstName: "Jean Claude Van",
                lastName: "Damme",
                company: "Acme",
                emails: ["jcvd@example.com"],
                phones: ["+1-555-0100"],
                address: "Apt 4\n1 Main St\n62701 Springfield\nIL\nUSA",
                labels: {
                    emails: { "jcvd@example.com": "work" },
                    phones: { "+1-555-0100": "mobile" },
                },
            }),
        ]);
    });

    it("unfolds lines folded with a space or a tab", () => {
        const { people } = parse_vcards(
            file("BEGIN:VCARD", "VERSION:3.0", "N:One;Some", " body;;;", "NOTE:a long", "\t note", "END:VCARD"),
        );
        // only the first blank of a continuation line goes
        expect(people[0]).toMatchObject({ lastName: "One", firstName: "Somebody", notes: "a long note" });
    });

    it("skips photos, empty cards and anything outside a card", () => {
        const { people, skipped } = parse_vcards(
            file(
                "junk before",
                "BEGIN:VCARD",
                "VERSION:3.0",
                "FN:With Photo",
                "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ",
                " AAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U",
                "EMAIL:photo@example.com",
                "END:VCARD",
                "BEGIN:VCARD",
                "VERSION:3.0",
                "UID:urn:uuid:1234",
                "END:VCARD",
            ),
        );

        expect(skipped).toBe(1);
        expect(people).toEqual([
            expect.objectContaining({
                firstName: "With",
                lastName: "Photo",
                emails: ["photo@example.com"],
            }),
        ]);
    });

    it("keeps a company-only card nameless", () => {
        const { people } = parse_vcards(file("BEGIN:VCARD", "FN:Acme", "ORG:Acme", "END:VCARD"));
        expect(people[0]).toMatchObject({ firstName: "", lastName: "", company: "Acme" });
    });

    it("drops repeated values within a card", () => {
        const { people } = parse_vcards(
            file("BEGIN:VCARD", "FN:A B", "EMAIL:a@b.com", "EMAIL;TYPE=work:a@b.com", "END:VCARD"),
        );
        expect(people[0].emails).toEqual(["a@b.com"]);
    });
});

describe("vcard_filename", () => {
    it("names one person's file after them, safely", () => {
        expect(vcard_filename([person({ firstName: "Some", lastName: "One" })])).toBe(
            "Some One.vcf",
        );
        expect(vcard_filename([person({ company: "A/B: C" })])).toBe("A_B_ C.vcf");
    });

    it("names any other count contacts.vcf", () => {
        expect(vcard_filename([])).toBe("contacts.vcf");
        expect(vcard_filename([person({}), person({})])).toBe("contacts.vcf");
    });
});
