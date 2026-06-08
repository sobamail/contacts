import { Person } from "$module/contacts/v1";
import { TAG_REPLIED } from "$lib/model";

const text = (v: string | null | undefined) => (v ?? "").trim();

// `into`'s items, then `from`'s that `into` lacks, blanks dropped; `same` says which two are one
function union(into: string[], from: string[], same: (a: string, b: string) => boolean) {
    const ret: string[] = [];
    for (const v of [...into, ...from].map(text)) {
        if (v && !ret.some((r) => same(r, v))) {
            ret.push(v);
        }
    }
    return ret;
}

// The label of each of `values`: `into`'s, else the one `from` gave the same value
function union_labels(
    values: string[],
    into: Record<string, string> | undefined,
    from: Record<string, string> | undefined,
    same: (a: string, b: string) => boolean,
) {
    const ret: Record<string, string> = {};
    for (const v of values) {
        const label =
            text(into?.[v]) ||
            text(Object.entries(from ?? {}).find(([k]) => same(text(k), v))?.[1]);
        if (label) {
            ret[v] = label;
        }
    }
    return ret;
}

const same_email = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const same_value = (a: string, b: string) => a === b;

// The person `into` becomes when it absorbs `from`: the user deduplicating the list, merging any
// two contacts. The name is `into`'s, `from`'s when `into` has none; any other field keeps
// `into`'s value and takes `from`'s where `into` has none, the notes keeping both. Lists are the
// union, `into`'s items first, an email's case ignored; a label of `into` wins over `from`'s.
// A merge is the user's edit, so the Replied tag Sobamail's collect gives goes (owner,
// 2026-10-19).
export function merge_people(into: Person, from: Person): Person {
    const named = text(into.firstName) || text(into.lastName);
    const notes = [text(into.notes), text(from.notes)].filter(Boolean);

    const emails = union(into.emails ?? [], from.emails ?? [], same_email);
    const phones = union(into.phones ?? [], from.phones ?? [], same_value);

    return new Person({
        uuid: into.uuid,
        firstName: named ? text(into.firstName) : text(from.firstName),
        lastName: named ? text(into.lastName) : text(from.lastName),
        jobTitle: text(into.jobTitle) || text(from.jobTitle),
        company: text(into.company) || text(from.company),
        address: text(into.address) || text(from.address),
        notes: (notes.length === 2 && notes[0] === notes[1] ? notes.slice(0, 1) : notes).join(
            "\n\n",
        ),
        emails,
        phones,
        tags: union(into.tags ?? [], from.tags ?? [], same_value).filter((t) => t !== TAG_REPLIED),
        labels: {
            emails: union_labels(emails, into.labels?.emails, from.labels?.emails, same_email),
            phones: union_labels(phones, into.labels?.phones, from.labels?.phones, same_value),
        },
    });
}
