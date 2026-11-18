import { describe, expect, it } from "vitest";
import {
    card_fragment,
    email_fragment,
    holds_email,
    parse_fragment,
    same_name,
    shown_panes,
    split_name,
} from "./fragment";

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

    it("shows a card by its uuid, the email and name ignored", () => {
        expect(parse_fragment("#person/show?uuid=%7Babc%7D")).toEqual({
            action: "card",
            uuid: "{abc}",
        });
        expect(parse_fragment("#person/show?uuid=u1&email=a@b.com")).toEqual({
            action: "card",
            uuid: "u1",
        });
        expect(parse_fragment("#" + card_fragment("{a b}"))).toEqual({
            action: "card",
            uuid: "{a b}",
        });
    });

    it("spells the email fragment as the client does", () => {
        expect(email_fragment(" a+b@c.com ", "Some One")).toBe(
            "person/show?email=a%2Bb%40c.com&name=Some%20One",
        );
        expect(parse_fragment("#" + email_fragment("a+b@c.com", "Some One"))).toEqual({
            action: "show",
            email: "a+b@c.com",
            name: "Some One",
        });
        expect(email_fragment("a@b.com", " ")).toBe("person/show?email=a%40b.com");
    });

    it("names the panes of pane/, in screen order", () => {
        expect(parse_fragment("#pane/left")).toEqual({ action: "pane", panes: ["left"] });
        expect(parse_fragment("#pane/right")).toEqual({ action: "pane", panes: ["right"] });
        expect(parse_fragment("#pane/right,left")).toEqual({
            action: "pane",
            panes: ["left", "right"],
        });
    });

    it("rejects an pane/ naming no pane, an unknown one or carrying a query", () => {
        for (const hash of ["#pane/", "#pane", "#pane/middle", "#pane/left,top", "#pane/left?x=1"]) {
            expect(parse_fragment(hash), hash).toBe("invalid");
        }
    });

    it("takes the first of a repeated item", () => {
        expect(parse_fragment("#person/show?email=a@b.com&email=c@d.com")).toMatchObject({
            email: "a@b.com",
        });
    });
});

describe("shown_panes", () => {
    it("shows every pane but under pane/", () => {
        expect(shown_panes("")).toEqual(["left", "right"]);
        expect(shown_panes("#person/new")).toEqual(["left", "right"]);
        expect(shown_panes("#pane/middle")).toEqual(["left", "right"]);
        expect(shown_panes("#pane/left")).toEqual(["left"]);
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
