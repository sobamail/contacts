// A light check for typos in an email address, not for deliverability: one "@", something
// before it, a domain with at least one dot, no blanks. user+tag@... and non-ASCII
// (IDN) addresses pass.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function is_email(s: string): boolean {
    return EMAIL.test(s.trim());
}

/** What the form accepts in an email row: an address, or nothing (blank rows are dropped). */
export function email_ok(s: string | null | undefined): boolean {
    const v = (s ?? "").trim();
    return v === "" || is_email(v);
}
