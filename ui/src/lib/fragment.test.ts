import { describe, expect, it } from "vitest";
import { holds_email, parse_fragment, same_name, split_name } from "./fragment";

describe("parse_fragment", () => {
    it("treats an empty fragment as the app's root", () => {
        expect(parse_fragment("")).toBeNull();
        expect(parse_fragment("#")).toBeNull();
    });

    it("opens an empty card on person/new, ignoring a query", () => {
        expect(parse_fragment("#person/new")).toEqual({ action: "new" });
        expect(parse_fragment("#person/new?email=a@b.com")).toEqual({ action: "new" });
    });

    it("rejects person/show without an email, and any other path", () => {
        for (const hash of [
            "#person/show",
            "#person/show?",
            "#person/show?name=Some%20One",
            "#person/show?email=",
            "#person/show?email=%20%20",
            "#person/edit?email=a@b.com",
            "#nonsense",
        ]) {
            expect(parse_fragment(hash), hash).toBe("invalid");
        }
    });

    it("rejects malformed percent-encoding", () => {
        expect(parse_fragment("#person/show?email=a@b.com&name=%E0%A4%A")).toBe("invalid");
    });

    it("decodes the client's QUrlQuery encoding", () => {
        expect(
            parse_fragment("#person/show?email=someone@example.com&name=Some%20One"),
        ).toEqual({ action: "show", email: "someone@example.com", name: "Some One" });
    });

    it("keeps a bare + instead of reading it as a space", () => {
        expect(parse_fragment("#person/show?email=user+tag@example.com")).toEqual({
            action: "show",
            email: "user+tag@example.com",
            name: "",
        });
    });

    it("cleans the name like the client's migration", () => {
        const show = (name: string) =>
            parse_fragment(`#person/show?email=a@b.com&name=${encodeURIComponent(name)}`);
        expect(show('"Some One"')).toMatchObject({ name: "Some One" });
        expect(show('  " Some One "  ')).toMatchObject({ name: "Some One" });
        expect(show("A@B.com")).toMatchObject({ name: "" });
        expect(show('"')).toMatchObject({ name: '"' });
    });

    it("takes the first of a repeated item", () => {
        expect(parse_fragment("#person/show?email=a@b.com&email=c@d.com")).toMatchObject({
            email: "a@b.com",
        });
    });
});

describe("split_name", () => {
    it("splits at the last blank", () => {
        expect(split_name("Some One")).toEqual(["Some", "One"]);
        expect(split_name("Jean Claude Van Damme")).toEqual(["Jean Claude Van", "Damme"]);
    });

    it("puts a single word into the first name", () => {
        expect(split_name("Cher")).toEqual(["Cher", ""]);
        expect(split_name("")).toEqual(["", ""]);
    });
});

describe("same_name", () => {
    it("compares first + last against the display name, ignoring spacing", () => {
        expect(same_name("Some", "One", "Some One")).toBe(true);
        expect(same_name("Some", "One", "  Some   One ")).toBe(true);
        expect(same_name("Cher", "", "Cher")).toBe(true);
        expect(same_name("Some", "One", "some one")).toBe(false);
        expect(same_name("Some", "Other", "Some One")).toBe(false);
    });
});

describe("holds_email", () => {
    it("matches exactly, ignoring case and surrounding blanks", () => {
        expect(holds_email([" Some@Example.com "], "some@example.com")).toBe(true);
        expect(holds_email(["some@example.com.tr"], "some@example.com")).toBe(false);
        expect(holds_email([], "some@example.com")).toBe(false);
    });
});
