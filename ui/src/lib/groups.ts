// Helpers for showing a group's members (GetGroupMembers): their names, the search
// over them, and their online status.

import type {GroupMemberInfoData} from "$module/contacts/v1";

// The search box over a group's members, client-side, folded like the backend's
// search (v1.mjs fold()): case and accents ignored, dotless ı as i.
export function fold(s: string): string {
    let ret = "";
    for (const c of s.normalize("NFKD")) {
        const cp = c.codePointAt(0)!;
        if (cp < 0x300 || cp > 0x36f) {
            ret += c;
        }
    }
    return ret.toLowerCase().replace(/ı/g, "i");
}

// What a member is shown as: the contact's name, else the address.
export function member_name(m: GroupMemberInfoData): string {
    const p = m.person;
    return (p && `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()) || m.address;
}

// Whether `query` is a substring of the member's address, name or any of its contact's
// values, folded.
export function member_matches(m: GroupMemberInfoData, query: string): boolean {
    const needle = fold(query.trim());
    if (! needle) {
        return true;
    }
    const p = m.person;
    const values = [ m.address, member_name(m) ];
    if (p) {
        values.push(p.jobTitle, p.company, ...(p.emails ?? []), ...(p.phones ?? []));
    }
    return values.some((v) => fold(v ?? "").includes(needle));
}

// A known online status. An unknown one is no status at all: the member gets no dot.
export type Presence = "online"|"away"|"offline";

export const PRESENCE_TEXT: Record<Presence, string> = {
    online : "Online",
    away : "Away",
    offline : "Offline",
};

// What a dot shows: a known status, or "unknown" for a group mate -- someone listed in one of
// the account's groups, `mates` holding their lowercased addresses -- whose status is not known
// yet.
export type BadgePresence = Presence|"unknown";
export const BADGE_PRESENCE_TEXT: Record<BadgePresence, string> = {
    ...PRESENCE_TEXT,
    unknown : "Status unknown",
};

// The dot of one address, by what `known` holds (lowercased addresses): its known status,
// unknown for a group mate, null, no dot, for anyone else.
export function address_presence(
        known: ReadonlyMap<string, Presence>, mates: ReadonlySet<string>,
        address: string|null|undefined): BadgePresence|null {
    const a = address?.trim().toLowerCase();
    if (! a) {
        return null;
    }
    return known.get(a) ?? (mates.has(a) ? "unknown" : null);
}

// The dot of a person reached at `addresses`: the most present of their dots -- online
// when any address is, else away, else offline when any is, unknown only when every dot
// is -- and null when none of them has one.
export function badge_presence(
        known: ReadonlyMap<string, Presence>, mates: ReadonlySet<string>,
        addresses: readonly (string|null|undefined)[]): BadgePresence|null {
    const dots = addresses.map((a) => address_presence(known, mates, a));
    for (const p of ["online", "away", "offline", "unknown"] as const) {
        if (dots.includes(p)) {
            return p;
        }
    }
    return null;
}

// The status a PresenceStatus event's `state` stands for (model.ts watch_presence): 2 online,
// 1 offline; 0, the host no longer knowing, and anything else is no status.
export function presence_of_state(state: unknown): Presence|null {
    switch (state) {
    case 2:
        return "online";
    case 1:
        return "offline";
    default:
        return null;
    }
}
