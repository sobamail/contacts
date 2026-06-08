// vCard export (3.0, RFC 2426) and import (2.1, 3.0 and 4.0), done in the UI: the backend
// only reads and writes the address book. 3.0 is what phones, Outlook and Google import
// without fuss.

import type { Labels, Person } from "$module/contacts/v1";
import { split_name } from "./fragment";

const CRLF = "\r\n";

// the vCard TYPE of a label, where vCard 3.0 has one
const TYPES = new Map([
    ["home", "HOME"],
    ["work", "WORK"],
    ["mobile", "CELL"],
    ["fax", "FAX"],
]);

// a text value with backslash, line breaks, comma and semicolon escaped
function text(s: string | null | undefined): string {
    return String(s ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

// the ;TYPE= parameter: the property's fixed types plus the label's, if vCard has one
function type(types: string[], label: string | undefined): string {
    const all = [...types, TYPES.get(label ?? "")].filter(Boolean);
    return all.length ? `;TYPE=${all.join(",")}` : "";
}

// a content line, folded at 75 octets of UTF-8 without splitting a character
function line(content: string): string {
    let ret = "";
    let octets = 0;
    for (const c of content) {
        const cp = c.codePointAt(0)!;
        const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
        if (octets + n > 75) {
            ret += CRLF + " ";
            octets = 1;
        }
        ret += c;
        octets += n;
    }
    return ret + CRLF;
}

function card(p: Person): string {
    const name = `${p.firstName} ${p.lastName}`.trim();
    const labels = p.labels ?? {};
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `UID:urn:uuid:${p.uuid.replace(/[{}]/g, "")}`,
        `N:${text(p.lastName)};${text(p.firstName)};;;`,
        `FN:${text(name || p.company || p.emails[0] || p.phones[0] || "Unnamed")}`,
    ];
    if (p.company) lines.push(`ORG:${text(p.company)}`);
    if (p.jobTitle) lines.push(`TITLE:${text(p.jobTitle)}`);
    for (const e of p.emails) {
        lines.push(`EMAIL${type(["INTERNET"], labels.emails?.[e])}:${text(e)}`);
    }
    for (const t of p.phones) {
        lines.push(`TEL${type([], labels.phones?.[t])}:${text(t)}`);
    }
    // the address is free text: all of it goes in the street component
    if (p.address) lines.push(`ADR:;;${text(p.address)};;;;`);
    if (p.notes) lines.push(`NOTE:${text(p.notes)}`);
    if (p.tags.length) lines.push(`CATEGORIES:${p.tags.map(text).join(",")}`);
    lines.push("END:VCARD");
    return lines.map(line).join("");
}

/** The vCard 3.0 text of `people`, one card after the other. */
export function vcard(people: Person[]): string {
    return people.map(card).join("");
}

/** A file name for the vCard of `people`: the person's name for one, else contacts.vcf. */
export function vcard_filename(people: Person[]): string {
    if (people.length !== 1) return "contacts.vcf";
    const p = people[0];
    const name = `${p.firstName} ${p.lastName}`.trim() || p.company || "contact";
    return `${name.replace(/[\\/:*?"<>|]+/g, "_")}.vcf`;
}

/** Hands `content` to the browser as a file download. */
export function download(content: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- import -------------------------------------------------------------------

/** What an imported card becomes: the fields of a new person for PutPerson. */
export type ImportedPerson = {
    firstName: string;
    lastName: string;
    jobTitle: string;
    company: string;
    emails: string[];
    phones: string[];
    tags: string[];
    address: string;
    notes: string;
    labels: Labels;
};

type Property = { name: string; params: Map<string, string[]>; value: string };

const HEX2 = /^[0-9A-Fa-f]{2}$/;

// the logical lines of a file: folding undone (a line starting with a blank continues
// the previous one) and vCard 2.1's quoted-printable soft line breaks ("=" at the end
// of a line) joined
function logical_lines(text: string): string[] {
    const lines: string[] = [];
    for (const raw of text.split(/\r\n|\r|\n/)) {
        const last = lines.length - 1;
        if (last >= 0 && (raw.startsWith(" ") || raw.startsWith("\t"))) {
            lines[last] += raw.slice(1);
        } else if (last >= 0 && /^[^:]*QUOTED-PRINTABLE/i.test(lines[last]) && lines[last].endsWith("=")) {
            lines[last] = lines[last].slice(0, -1) + raw;
        } else {
            lines.push(raw);
        }
    }
    return lines;
}

// splits on `sep` outside double quotes
function split_unquoted(s: string, sep: string): string[] {
    const parts = [""];
    let quoted = false;
    for (const c of s) {
        if (c === '"') quoted = !quoted;
        if (c === sep && !quoted) parts.push("");
        else parts[parts.length - 1] += c;
    }
    return parts;
}

// [group.]NAME[;param...]:value, with 2.1's bare parameters (TEL;CELL) read as TYPEs
function parse_property(line: string): Property | null {
    let colon = -1;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ":" && !quoted) {
            colon = i;
            break;
        }
    }
    if (colon < 0) return null;

    const [head, ...params] = split_unquoted(line.slice(0, colon), ";");
    const ret: Property = {
        name: head.replace(/^.*\./, "").trim().toUpperCase(),
        params: new Map(),
        value: line.slice(colon + 1),
    };
    for (const p of params) {
        const eq = p.indexOf("=");
        const key = (eq < 0 ? "TYPE" : p.slice(0, eq)).trim().toUpperCase();
        const values = (eq < 0 ? p : p.slice(eq + 1))
            .split(",")
            .map((v) => v.trim().replace(/^"|"$/g, "").toLowerCase())
            .filter(Boolean);
        ret.params.set(key, [...(ret.params.get(key) ?? []), ...values]);
    }
    return ret;
}

function param(p: Property, key: string): string[] {
    return p.params.get(key) ?? [];
}

function encoding(p: Property): string {
    const all = [...param(p, "ENCODING"), ...param(p, "TYPE")];
    if (all.includes("quoted-printable")) return "qp";
    if (all.includes("b") || all.includes("base64")) return "binary";
    return "";
}

// vCard 2.1 quoted-printable, in the property's CHARSET (UTF-8 when none or unknown)
function qp_decode(s: string, charset: string): string {
    const utf8 = new TextEncoder();
    const bytes: number[] = [];
    let i = 0;
    while (i < s.length) {
        if (s[i] === "=" && HEX2.test(s.slice(i + 1, i + 3))) {
            bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 3;
            continue;
        }
        const c = String.fromCodePoint(s.codePointAt(i)!);
        bytes.push(...utf8.encode(c));
        i += c.length;
    }
    try {
        return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
    } catch {
        return new TextDecoder().decode(new Uint8Array(bytes));
    }
}

// splits on an unescaped `sep`, leaving the escapes for unescape()
function split_escaped(s: string, sep: string): string[] {
    const parts = [""];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\" && i + 1 < s.length) {
            parts[parts.length - 1] += s[i] + s[i + 1];
            i++;
        } else if (s[i] === sep) {
            parts.push("");
        } else {
            parts[parts.length - 1] += s[i];
        }
    }
    return parts;
}

function unescape(s: string): string {
    return s.replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

// the first of `wanted` (in priority order) among a property's types, as our label
function label_of(p: Property, wanted: [string[], string][]): string {
    const types = param(p, "TYPE");
    for (const [names, label] of wanted) {
        if (names.some((n) => types.includes(n))) return label;
    }
    return "";
}

const EMAIL_LABELS: [string[], string][] = [
    [["work"], "work"],
    [["home"], "home"],
];
const PHONE_LABELS: [string[], string][] = [
    [["fax"], "fax"],
    [["cell", "mobile", "iphone"], "mobile"],
    [["work"], "work"],
    [["home"], "home"],
];

// ADR's post-office box; extended; street; locality; region; postal code; country, as
// the free text our address is: one component a line, the code before the locality
function address_of(value: string): string {
    const [pobox = "", ext = "", street = "", locality = "", region = "", code = "", country = ""] =
        split_escaped(value, ";").map((c) => unescape(c).trim());
    return [pobox, ext, street, [code, locality].filter(Boolean).join(" "), region, country]
        .filter(Boolean)
        .join("\n");
}

function person_of(props: Property[]): ImportedPerson | null {
    const p: ImportedPerson = {
        firstName: "",
        lastName: "",
        jobTitle: "",
        company: "",
        emails: [],
        phones: [],
        tags: [],
        address: "",
        notes: "",
        labels: {},
    };
    const add = (key: "emails" | "phones", value: string, label: string) => {
        const v = value.trim();
        if (!v || p[key].includes(v)) return;
        p[key].push(v);
        if (label) (p.labels[key] ??= {})[v] = label;
    };

    let fn = "";
    for (const prop of props) {
        const enc = encoding(prop);
        if (enc === "binary") continue; // PHOTO and the like
        const raw = enc === "qp" ? qp_decode(prop.value, param(prop, "CHARSET")[0] ?? "") : prop.value;

        switch (prop.name) {
            case "N": {
                const [last = "", first = "", middle = ""] = split_escaped(raw, ";").map((c) =>
                    unescape(c).trim(),
                );
                p.lastName = last;
                p.firstName = [first, middle].filter(Boolean).join(" ");
                break;
            }
            case "FN":
                fn = unescape(raw).trim();
                break;
            case "ORG":
                p.company = unescape(split_escaped(raw, ";")[0]).trim();
                break;
            case "TITLE":
                p.jobTitle = unescape(raw).trim();
                break;
            case "EMAIL":
                add("emails", unescape(raw).replace(/^mailto:/i, ""), label_of(prop, EMAIL_LABELS));
                break;
            case "TEL":
                add("phones", unescape(raw).replace(/^tel:/i, ""), label_of(prop, PHONE_LABELS));
                break;
            case "ADR":
                if (!p.address) p.address = address_of(raw);
                break;
            case "NOTE":
                p.notes = [p.notes, unescape(raw).trim()].filter(Boolean).join("\n");
                break;
            case "CATEGORIES":
                for (const t of split_escaped(raw, ",").map((c) => unescape(c).trim())) {
                    if (t && !p.tags.includes(t)) p.tags.push(t);
                }
                break;
        }
    }

    // no N: the name from FN, unless FN only repeats the company
    if (!p.firstName && !p.lastName && fn && fn !== p.company) {
        [p.firstName, p.lastName] = split_name(fn);
    }

    const empty =
        [p.firstName, p.lastName, p.jobTitle, p.company, p.address, p.notes].every((v) => !v) &&
        p.emails.length + p.phones.length + p.tags.length === 0;
    return empty ? null : p;
}

/**
 * The people in a vCard file (2.1, 3.0 or 4.0), and how many cards had nothing usable.
 * Photos and other binaries are skipped; a card's UID is not kept (each becomes a new
 * person).
 */
export function parse_vcards(text: string): { people: ImportedPerson[]; skipped: number } {
    const people: ImportedPerson[] = [];
    let skipped = 0;
    let card: Property[] | null = null;

    for (const line of logical_lines(text)) {
        const prop = parse_property(line);
        if (!prop) continue;
        const value = prop.value.trim().toUpperCase();
        if (prop.name === "BEGIN" && value === "VCARD") {
            card = [];
        } else if (prop.name === "END" && value === "VCARD") {
            if (card) {
                const p = person_of(card);
                if (p) people.push(p);
                else skipped++;
            }
            card = null;
        } else if (card) {
            card.push(prop);
        }
    }
    return { people, skipped };
}
