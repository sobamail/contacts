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
    process(): void;
}

export class GetPeople {
    constructor(init?: { filter?: string; tagFilter?: string[]; limit?: number; offset?: number });
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
