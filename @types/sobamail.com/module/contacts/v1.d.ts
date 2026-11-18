// Type declarations for the runtime module `sobamail.com/module/contacts/v1.mjs`.
// The `$module/*` tsconfig path points here for type-checking, while the Vite
// alias points at the `.mjs` for runtime. Keep these class shapes in sync with
// the constructors in v1.mjs.

export const namespace: string;

/** list key ("emails", "phones") -> value -> label ("work", "mobile"...) */
export type Labels = Record<string, Record<string, string>>;

export interface PersonData {
    uuid: string;
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
}

export class Person implements PersonData {
    constructor(init?: Partial<PersonData>);
    uuid: string;
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
}

export class GetPeopleResponse {
    constructor(init?: { data?: Person[] });
    data: Person[];
}

export class PutPersonResponse {
    constructor(init?: { uuid?: string });
    uuid: string;
}

// Thrown by a constructor whose content lacks a required field.
export class MalformedObject extends Error {}

// The replicated events, for the tests in ui/.

export class AddPerson {
    constructor(init?: { uuid?: string });
    process(): void;
}

export class SetPersonAttr {
    constructor(init?: { person?: string; key?: string; value?: unknown });
    process(): void;
}

export class AddPersonAttr {
    constructor(init?: { person?: string; key?: string });
    process(): void;
}

export class AddPersonAttrValue {
    constructor(init?: { person?: string; key?: string; value?: unknown });
    process(): void;
}

export class SetPersonAttrLabel {
    constructor(init?: { person?: string; key?: string; value?: unknown; label?: string });
    process(): void;
}

// The request objects, for the tests in ui/ that run them on a stand-in runtime.

export class PutPerson implements PersonData {
    constructor(init?: Partial<PersonData> & { base?: Partial<PersonData> | null });
    base: Partial<PersonData> | null;
    uuid: string;
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
    // mailed: the server's colleague card (a PutPerson mailed by apps@), not a ui request
    process(opts?: { mailed?: boolean }): void;
}

export class GetPeople {
    constructor(init?: { filter?: string; tagFilter?: string[]; limit?: number; offset?: number });
    process(): void;
}

export interface TagInfoData {
    name: string;
    count: number;
}

export class TagInfo implements TagInfoData {
    constructor(init?: Partial<TagInfoData>);
    name: string;
    count: number;
}

export class GetTagsResponse {
    constructor(init?: { data?: TagInfo[] });
    data: TagInfo[];
}

export class GetTags {
    constructor(init?: Record<string, never>);
    process(): void;
}

export class GetPerson {
    constructor(init?: { uuid?: string });
    process(): void;
}

export class DeletePerson {
    constructor(init: { uuid: string });
    process(): void;
}

// The group objects the server mails, and the replicated events they write.

export class Group {
    constructor(init?: { uuid?: string });
    process(): void;
}

export class GroupAttr {
    constructor(init?: { grp?: string; key?: string; value?: unknown });
    process(): void;
}

export class GroupMember {
    constructor(init?: { grp?: string; address?: string });
    process(): void;
}

export class AddGroup {
    constructor(init?: { uuid?: string });
    process(): void;
}

export class DelGroup {
    constructor(init?: { uuid?: string });
    process(): void;
}

export class SetAttrGroup {
    constructor(init?: { uuid?: string; key?: string; value?: string });
    process(): void;
}

export class UnsetAttrGroup {
    constructor(init?: { uuid?: string; key?: string });
    process(): void;
}

export class AddGroupMember {
    constructor(init?: { uuid?: string; address?: string });
    process(): void;
}

export class DelGroupMember {
    constructor(init?: { uuid?: string; address?: string });
    process(): void;
}

// Reading the groups.

export interface GroupInfoData {
    uuid: string;
    name: string;
    type: string;
    size: number;
}

export class GroupInfo implements GroupInfoData {
    constructor(init?: Partial<GroupInfoData>);
    uuid: string;
    name: string;
    type: string;
    size: number;
}

export class GetGroupsResponse {
    constructor(init?: { data?: GroupInfo[] });
    data: GroupInfo[];
}

export class GetGroups {
    constructor(init?: Record<string, never>);
    process(): void;
}

export interface GroupMemberInfoData {
    address: string;
    person: PersonData | null;
}

export class GroupMemberInfo implements GroupMemberInfoData {
    constructor(init?: Partial<GroupMemberInfoData>);
    address: string;
    person: PersonData | null;
}

export class GetGroupMembersResponse {
    constructor(init?: { data?: GroupMemberInfo[] });
    data: GroupMemberInfo[];
}

export class GetGroupMembers {
    constructor(init?: { uuid?: string });
    process(): void;
}

/** The SMC object of a mailed structured message the app takes, or null. */
export function mailed_object(
    message: unknown,
): { namespace: string; name: string; content: unknown } | null;

/** The base module's mail classes, which the Mutator hands to SendVCard.process(). */
export type MailClasses = {
    Message: new () => unknown;
    MessageAttachment: new (init: { name: string; type: string; blobs: ArrayBuffer[] }) => unknown;
};

export class SendVCard {
    constructor(init?: {
        to?: string[] | string;
        filename?: string;
        vcard?: string;
        subject?: string;
        text?: string;
    });
    to: string[];
    filename: string;
    vcard: string;
    subject: string;
    text: string;
    process(mail: MailClasses): void;
}

export class SendVCardResponse {
    constructor(init?: { to?: string[] });
    to: string[];
}
