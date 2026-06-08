import { describe, expect, it } from "vitest";
import { label_text, labels_map, labels_of } from "./labels";

describe("labels", () => {
    it("line up with the values they label", () => {
        expect(labels_of(["a@x.com", " b@x.com ", "c@x.com"], { "b@x.com": "work" })).toEqual([
            "",
            "work",
            "",
        ]);
        expect(labels_of(["a@x.com"], undefined)).toEqual([""]);
    });

    it("fold back into a map, without blank values or labels", () => {
        expect(
            labels_map([" a@x.com ", "", "c@x.com", "d@x.com"], ["home", "work", " ", "other"]),
        ).toEqual({ "a@x.com": "home", "d@x.com": "other" });
    });

    it("read as words", () => {
        expect(label_text("mobile")).toBe("Mobile");
        expect(label_text("")).toBe("No label");
    });
});
