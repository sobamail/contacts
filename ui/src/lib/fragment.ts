// The fragments the mail client launches the app with:
// - person/new: an empty new contact card; a query is ignored.
// - person/show?email=<address>&name=<display name>, from its "Open contact
//   card..." action and the contact button in the reader header's address
//   pills. The client trims both values, percent-encodes them with QUrlQuery
//   and leaves out an empty one. The email is mandatory.
// - person/show?uuid=<uuid>: that card, from a click in the narrow view
//   (open_full); the email and name are ignored then.
// - pane/<pane>[,<pane>]: the named panes alone, for the client's narrow side
//   bar view (pane/left). Unlike the others it stays in the URL, so a reload
//   keeps the panes.
// Any other fragment is invalid.

export type PersonShow = {
    action: "show";
    email: string;
    name: string; // cleaned like the client's migration cleans it, may be ""
};

// left: the contact list; right: the card or the form, with the toolbar
export type Pane = "left" | "right";
export const PANES: Pane[] = ["left", "right"];

export type Launch =
    | PersonShow
    | { action: "card"; uuid: string }
    | { action: "new" }
    | { action: "pane"; panes: Pane[] };

/** The fragment that shows the card `uuid`. */
export function card_fragment(uuid: string): string {
    return `person/show?uuid=${encodeURIComponent(uuid)}`;
}

/** The fragment that shows the card holding `email`, as the client's "Open contact card...". */
export function email_fragment(email: string, name: string): string {
    const n = name.trim();
    return (
        `person/show?email=${encodeURIComponent(email.trim())}` +
        (n ? `&name=${encodeURIComponent(n)}` : "")
    );
}

/**
 * The narrow view shows the list alone: a click there opens the full app on
 * what was clicked. The client takes a new window on the app's own document
 * to its tab of the app (amp-cef app_open_request), launched on `fragment`.
 */
export function open_full(fragment: string) {
    window.open(`#${fragment}`, "_blank");
}

/** The panes an pane/ path names, in screen order; null when it names none or an unknown one. */
export function parse_panes(path: string): Pane[] | null {
    if (!path.startsWith("pane/")) return null;
    const names = path.slice("pane/".length).split(",");
    if (names.some((n) => !(PANES as string[]).includes(n))) return null;
    const panes = PANES.filter((p) => names.includes(p));
    return panes.length > 0 ? panes : null;
}

/** The panes the page shows for location.hash: every pane unless it is an pane/ fragment. */
export function shown_panes(hash: string): Pane[] {
    const f = parse_fragment(hash);
    return f !== null && f !== "invalid" && f.action === "pane" ? f.panes : [...PANES];
}

/**
 * Parses location.hash: null for an empty fragment (the app's root),
 * "invalid" for one the app removes.
 */
export function parse_fragment(hash: string): Launch | "invalid" | null {
    const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
    if (fragment === "") return null;

    const q = fragment.indexOf("?");
    const path = q < 0 ? fragment : fragment.slice(0, q);
    if (path === "person/new") return { action: "new" };
    if (path.startsWith("pane/")) {
        const panes = q < 0 ? parse_panes(path) : null;
        return panes ? { action: "pane", panes } : "invalid";
    }
    if (path !== "person/show" || q < 0) return "invalid";

    // Not URLSearchParams: it decodes "+" to a space, while QUrlQuery leaves a
    // literal "+" bare, as in user+tag@example.com.
    const params = new Map<string, string>();
    for (const item of fragment.slice(q + 1).split("&")) {
        const eq = item.indexOf("=");
        let key: string, value: string;
        try {
            key = decodeURIComponent(eq < 0 ? item : item.slice(0, eq));
            value = decodeURIComponent(eq < 0 ? "" : item.slice(eq + 1));
        } catch {
            return "invalid"; // malformed percent-encoding
        }
        if (!params.has(key)) params.set(key, value);
    }

    const uuid = (params.get("uuid") ?? "").trim();
    if (uuid !== "") return { action: "card", uuid };

    const email = (params.get("email") ?? "").trim();
    if (email === "") return "invalid";
    return {
        action: "show",
        email,
        name: clean_name(params.get("name") ?? "", email),
    };
}

// The display name is whatever the message header carried. Like the client's
// migration: one pair of surrounding double quotes goes, and a name that is the
// address again is no name.
function clean_name(name: string, email: string): string {
    let n = name.trim();
    if (n.length >= 2 && n.startsWith('"') && n.endsWith('"')) {
        n = n.slice(1, -1).trim();
    }
    return n.toLowerCase() === email.toLowerCase() ? "" : n;
}

/** [firstName, lastName], split at the last blank like the migration does. */
export function split_name(name: string): [string, string] {
    const i = name.lastIndexOf(" ");
    return i < 0 ? [name, ""] : [name.slice(0, i).trim(), name.slice(i + 1)];
}

/** Whether a card's first and last name spell the display name. */
export function same_name(first: string, last: string, name: string): boolean {
    const norm = (s: string) => s.trim().split(/\s+/).join(" ");
    return norm(`${first} ${last}`) === norm(name);
}

export function holds_email(emails: string[], email: string): boolean {
    const e = email.toLowerCase();
    return emails.some((x) => x.trim().toLowerCase() === e);
}
