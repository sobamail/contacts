import { describe, expect, it } from "vitest";
import { email_ok, is_email } from "./email";

describe("is_email", () => {
    it("accepts ordinary, tagged and non-ASCII addresses", () => {
        for (const s of [
            "someone@example.com",
            " someone@example.com ",
            "user+tag@example.com",
            "first.last@mail.example.com.tr",
            "şükrü@örnek.com.tr",
        ]) {
            expect(is_email(s), s).toBe(true);
        }
    });

    it("rejects the usual typos", () => {
        for (const s of [
            "",
            "someone",
            "someone@",
            "@example.com",
            "someone@example",
            "someone@.com",
            "someone@example..com",
            "someone@example.com.",
            "some one@example.com",
            "someone@@example.com",
            "someone@exa mple.com",
        ]) {
            expect(is_email(s), s).toBe(false);
        }
    });
});

describe("email_ok", () => {
    it("lets a blank row through, since saving drops it", () => {
        expect(email_ok("")).toBe(true);
        expect(email_ok("  ")).toBe(true);
        expect(email_ok(undefined)).toBe(true);
        expect(email_ok("someone@")).toBe(false);
    });
});
