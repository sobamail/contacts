import { describe, expect, it } from "vitest";
import { Person } from "$module/contacts/v1";
import {
    address_presence,
    badge_presence,
    member_matches,
    member_name,
    presence_of_state,
} from "$lib/groups";

const ann = {
    address: "ann@example.com",
    person: new Person({ firstName: "Şule", lastName: "Kaya", company: "Acme" }),
};
const bare = { address: "bob@example.com", person: null };

describe("group members", () => {
    it("go by the contact's name, else the address", () => {
        expect(member_name(ann)).toBe("Şule Kaya");
        expect(member_name(bare)).toBe("bob@example.com");
        expect(member_name({ address: "c@example.com", person: new Person({}) })).toBe(
            "c@example.com",
        );
    });

    it("match the search on name, address or contact values, accents ignored", () => {
        expect(member_matches(ann, "sule")).toBe(true);
        expect(member_matches(ann, "ACME")).toBe(true);
        expect(member_matches(ann, "ann@")).toBe(true);
        expect(member_matches(ann, "bob")).toBe(false);
        expect(member_matches(bare, "bob")).toBe(true);
        expect(member_matches(bare, "  ")).toBe(true);
    });

    it("are online when any address is, else offline when any is, else unknown", () => {
        const known = new Map([
            ["a@x.com", "offline" as const],
            ["b@x.com", "online" as const],
            ["c@x.com", "away" as const],
            ["d@x.com", "offline" as const],
        ]);
        const none = new Set<string>();
        expect(badge_presence(known, none, ["A@x.com"])).toBe("offline");
        expect(badge_presence(known, none, ["a@x.com", " D@X.com ", ""])).toBe("offline");
        expect(badge_presence(known, none, ["a@x.com", " B@X.com "])).toBe("online");
        expect(badge_presence(known, none, ["a@x.com", "c@x.com"])).toBe("away");
        expect(badge_presence(known, none, ["c@x.com", "b@x.com"])).toBe("online");
        // a known offline wins over an address of no known status, a mate's or not
        expect(badge_presence(known, none, ["a@x.com", "z@x.com"])).toBe("offline");
        expect(badge_presence(known, new Set(["z@x.com"]), ["a@x.com", "z@x.com"])).toBe(
            "offline",
        );
        expect(badge_presence(known, new Set(["y@x.com", "z@x.com"]), ["y@x.com", "z@x.com"]))
            .toBe("unknown");
        expect(badge_presence(known, none, ["z@x.com", null, undefined, ""])).toBeNull();
        expect(badge_presence(known, none, [])).toBeNull();
    });

    it("are unknown for a group mate whose status is not known, nothing for anyone else", () => {
        const known = new Map([["b@x.com", "online" as const]]);
        const mates = new Set(["a@x.com", "b@x.com"]);
        expect(badge_presence(known, mates, [" A@X.com "])).toBe("unknown");
        expect(badge_presence(known, mates, ["a@x.com", "b@x.com"])).toBe("online");
        expect(badge_presence(known, mates, ["z@x.com", null])).toBeNull();
        expect(badge_presence(known, mates, [])).toBeNull();
    });

    it("dot each address by its own status", () => {
        const known = new Map([["b@x.com", "offline" as const]]);
        const mates = new Set(["a@x.com", "b@x.com"]);
        expect(address_presence(known, mates, " B@X.com ")).toBe("offline");
        expect(address_presence(known, mates, "a@x.com")).toBe("unknown");
        expect(address_presence(known, mates, "z@x.com")).toBeNull();
        expect(address_presence(known, mates, "")).toBeNull();
        expect(address_presence(known, mates, null)).toBeNull();
    });

    it("are online or offline by the host's state, else of no known status", () => {
        expect(presence_of_state(2)).toBe("online");
        expect(presence_of_state(1)).toBe("offline");
        expect(presence_of_state(0)).toBeNull();
        expect(presence_of_state(3)).toBeNull();
        expect(presence_of_state("2")).toBeNull();
        expect(presence_of_state(undefined)).toBeNull();
    });
});
