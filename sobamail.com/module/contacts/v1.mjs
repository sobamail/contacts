export const namespace = "https://sobamail.com/module/contacts/v1";

// Thrown by a constructor whose content lacks a required field. The Mutator drops such an
// object: throwing out of process() would have it retried forever.
export class MalformedObject extends Error {}

export class AddPerson {
    static KEY = `{${namespace}}${this.name}`;
    constructor({uuid} = {}) {
        if (! uuid) {
            throw new MalformedObject("Missing Person.uuid");
        }
        this.uuid = uuid;
    }

    process() { soba.data.insert("person", this); }

    asText(locale) { return `Add contact ${this.uuid}`; }
    toString() { return `AddPerson(${this.uuid})`; }
}

export class SetPersonAttr {
    static KEY = `{${namespace}}${this.name}`;
    constructor({person, key, value} = {}) {
        if (! person) {
            throw new MalformedObject("Missing PersonAttr.person");
        }
        if (! key) {
            throw new MalformedObject("Missing PersonAttr.key");
        }

        this.person = person;
        this.key = key;
        this.value = value;
    }

    process() { soba.data.insert("person_attr_single", this); }

    asText(locale) { return `Set ${this.key} of contact ${this.person} to '${this.value}'`; }
    toString() { return `SetPersonAttr(${this.person}, '${this.key}', '${this.value}')`; }
}

export class AddPersonAttr {
    static KEY = `{${namespace}}${this.name}`;
    constructor({person, key} = {}) {
        if (! person) {
            throw new MalformedObject("Missing PersonAttr.person");
        }
        if (! key) {
            throw new MalformedObject("Missing PersonAttr.key");
        }

        this.person = person;
        this.key = key;
    }

    process() { soba.data.insert("person_attr_multi", this); }

    asText(locale) { return `Start the ${this.key} list of contact ${this.person}`; }
    toString() { return `AddPersonAttr(${this.person}, '${this.key}')`; }
}

export class AddPersonAttrValue {
    static KEY = `{${namespace}}${this.name}`;
    constructor({person, key, value} = {}) {
        if (! person) {
            throw new MalformedObject("Missing PersonAttrValue.person");
        }
        if (! key) {
            throw new MalformedObject("Missing PersonAttrValue.key");
        }

        this.person = person;
        this.key = key;
        this.value = value;
    }

    process() { soba.data.insert("person_attr_multi_value", this); }

    asText(locale) { return `Add '${this.value}' to the ${this.key} of contact ${this.person}`; }
    toString() { return `AddPersonAttrValue(${this.person}, '${this.key}', '${this.value}')`; }
}

// The label (work, home, mobile...) of one value in a person's emails or phones
export class SetPersonAttrLabel {
    static KEY = `{${namespace}}${this.name}`;
    constructor({person, key, value, label} = {}) {
        if (! person) {
            throw new MalformedObject("Missing PersonAttrLabel.person");
        }
        if (! key) {
            throw new MalformedObject("Missing PersonAttrLabel.key");
        }
        if (value === null || value === undefined) {
            throw new MalformedObject("Missing PersonAttrLabel.value");
        }
        if (! label) {
            throw new MalformedObject("Missing PersonAttrLabel.label");
        }

        this.person = person;
        this.key = key;
        this.value = value;
        this.label = label;
    }

    process() { soba.data.insert("person_attr_label", this); }

    asText(locale) {
        return `Label '${this.value}' in the ${this.key} of contact ${this.person} '${this.label}'`;
    }
    toString() {
        return `SetPersonAttrLabel(${this.person}, '${this.key}', '${this.value}', '${this.label}')`;
    }
}

const SINGLE_ATTRS = [ "firstName", "lastName", "jobTitle", "company", "address", "notes" ];
const MULTI_ATTRS = [ "emails", "phones", "tags" ];
const LABELLED_ATTRS = [ "emails", "phones" ];

function clean_text(v) { return (v === null || v === undefined) ? "" : String(v).trim(); }

function clean_list(v) {
    return Array.isArray(v) ? [...new Set(v.map(clean_text).filter(Boolean)) ] : [];
}

// {value: label} as a Map of trimmed values to trimmed labels, blank labels dropped
function clean_labels(v) {
    const ret = new Map();
    if (v && typeof v === "object") {
        for (const [value, label] of Object.entries(v)) {
            if (clean_text(label)) {
                ret.set(clean_text(value), clean_text(label));
            }
        }
    }
    return ret;
}

function same_values(a, b) { return a.length === b.length && a.every((v) => b.includes(v)); }

function query(sql, ...params) {
    const ret = soba.db.exec(sql, ...params);
    if (ret.code !== 0) {
        throw new Error(`Query failed with code ${ret.code}: ${sql}`);
    }
    return ret.data;
}

function delete_row(table, key) {
    const row = soba.data.find(table, key);
    if (! row.deleted) {
        soba.data.delete(table, row.hash);
    }
}

// case and accent insensitive form for search, so "ŞAHİN", "şahin" and "sahin" all become
// "sahin": decompose, drop the combining diacritical marks (U+0300 to U+036F), lowercase.
// dotless ı has no decomposition, so it is mapped by hand.
function fold(s) {
    let ret = "";
    for (const c of String(s).normalize("NFKD")) {
        const cp = c.codePointAt(0);
        if (cp < 0x300 || cp > 0x36f) {
            ret += c;
        }
    }
    return ret.toLowerCase().replace(/ı/g, "i");
}

function compare_folded(a, b) { return fold(a).localeCompare(fold(b)); }

// every attribute of every person: (person, key, value, multi). multi-value attributes come
// as a json array in value with multi = 1.
const QSTR_PERSON_ATTRS = `SELECT person,
    key,
    value,
    0 AS multi
FROM person_attr_single
UNION
SELECT pamv.person,
    pamv.key,
    json_group_array(pamv.value),
    1
FROM person_attr_multi pam
    JOIN person_attr_multi_value pamv ON (
        pam.person = pamv.person
        AND pam.key = pamv.key
    )
GROUP BY pamv.person,
    pamv.key`;

// every searchable value: (person, value)
const QSTR_PERSON_VALUES = `SELECT person,
    value
FROM person_attr_single
UNION ALL
SELECT person,
    value
FROM person_attr_multi_value`;

// every person's name: (person, firstName, lastName)
const QSTR_PERSON_NAMES = `SELECT p.uuid,
    f.value,
    l.value
FROM person p
    LEFT JOIN person_attr_single f ON (
        f.person = p.uuid
        AND f.key = 'firstName'
    )
    LEFT JOIN person_attr_single l ON (
        l.person = p.uuid
        AND l.key = 'lastName'
    )`;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// display order of QSTR_PERSON_NAMES rows: by last name (the first name when there is
// none), then first name, ignoring case and accents. people without a name go last, the
// uuid breaks ties.
function compare_names([a_uuid, a_first, a_last ], [b_uuid, b_first, b_last ]) {
    const a = [ fold(a_last ?? "") || fold(a_first ?? ""), fold(a_first ?? "") ];
    const b = [ fold(b_last ?? "") || fold(b_first ?? ""), fold(b_first ?? "") ];
    if (! a[0] !== ! b[0]) {
        return a[0] ? -1 : 1;
    }
    return compare(a[0], b[0]) || compare(a[1], b[1]) || compare(a_uuid, b_uuid);
}

// sets one person_attr_label row on a Person
function assign_label(person, key, value, label) { (person.labels[key] ??= {})[value] = label; }

// sets one row of QSTR_PERSON_ATTRS on a Person
function assign_attr(person, key, value, multi) {
    if (! multi) {
        person[key] = value;
        return;
    }

    const values = JSON.parse(value);
    if (key === "emails") {
        values.sort(compare_folded);
    }
    person[key] = values;
}

// every person's uuid in display order, or only those in the Set `matches`
function ordered_uuids(matches = null) {
    return query(QSTR_PERSON_NAMES)
            .filter(([uuid]) => ! matches || matches.has(uuid))
            .sort(compare_names)
            .map(([uuid]) => uuid);
}

// the people of `uuids` with all their attributes and labels, in that order. a uuid with
// nothing stored comes back as an empty Person.
function load_people(uuids) {
    const json = JSON.stringify(uuids);
    const people = new Map(uuids.map((u) => [ u, new Person({uuid : u}) ]));

    // the left join keeps people that have no attributes at all: one row with a null key
    for (const [u, key, value, multi] of query(`SELECT p.value,
    a.key,
    a.value,
    a.multi
FROM json_each(?) AS p
LEFT JOIN (${QSTR_PERSON_ATTRS}) AS a ON a.person = p.value`,
                 json)) {
        if (key !== null && key !== undefined) {
            assign_attr(people.get(u), key, value, multi);
        }
    }

    for (const [u, key, value, label] of query(`SELECT l.person,
    l.key,
    l.value,
    l.label
FROM json_each(?) AS p
    JOIN person_attr_label l ON l.person = p.value`,
                 json)) {
        assign_label(people.get(u), key, value, label);
    }

    return Array.from(people.values());
}

export class PutPersonResponse {
    static KEY = `{${namespace}}${this.name}`;
    constructor({uuid} = {}) { this.uuid = uuid; }
}

export class PutPerson {
    static KEY = `{${namespace}}${this.name}`;
    constructor({
        uuid = "",
        firstName = "",
        lastName = "",
        jobTitle = "",
        company = "",
        emails = [],
        phones = [],
        tags = [],
        address = "",
        notes = "",
        labels = {},
        base = null,
    } = {}) {
        this.uuid = uuid;
        this.firstName = firstName;
        this.lastName = lastName;
        this.jobTitle = jobTitle;
        this.company = company;
        this.emails = emails;
        this.phones = phones;
        this.tags = tags;
        this.address = address;
        this.notes = notes;
        this.labels = labels;
        this.base = base;
    }

    // Without a base, replaces the whole person: a blank or missing field is removed from
    // the stored one. With the base an edit form started from, applies only what the user
    // changed against it, so changes synced in from another replica meanwhile survive; a
    // field the user did change wins over such a change.
    process() {
        const single = SINGLE_ATTRS.map((key) => [ key, clean_text(this[key]) ]);
        const multi = MULTI_ATTRS.map((key) => [ key, clean_list(this[key]) ]);
        const base = this.uuid ? this.base : null;

        if (! this.uuid) {
            if (single.every(([, v ]) => ! v) && multi.every(([, v ]) => v.length === 0)) {
                soba.log.warning("Refusing to create an empty person");
                return;
            }
            this.uuid = soba.type.uuid.v4();
        }

        // current state, to find what this request removes
        const cur_single = new Set(
                query("SELECT key FROM person_attr_single WHERE person = ?", this.uuid)
                        .map((r) => r[0]));
        const cur_multi = new Map();
        for (const [key, value] of query(
                     "SELECT key, value FROM person_attr_multi_value WHERE person = ?",
                     this.uuid)) {
            if (! cur_multi.has(key)) {
                cur_multi.set(key, []);
            }
            cur_multi.get(key).push(value);
        }
        const cur_labels = new Map();
        for (const [key, value, label] of query(
                     "SELECT key, value, label FROM person_attr_label WHERE person = ?",
                     this.uuid)) {
            if (! cur_labels.has(key)) {
                cur_labels.set(key, new Map());
            }
            cur_labels.get(key).set(value, label);
        }

        // ensure person row exists
        (new AddPerson({uuid : this.uuid})).process();

        // single-value attributes: lww replaces a changed value, a cleared one is deleted
        for (const [key, value] of single) {
            if (base && value === clean_text(base[key])) {
                continue; // not changed by the user
            }

            if (value) {
                (new SetPersonAttr({person : this.uuid, key, value})).process();
            }
            else if (cur_single.has(key)) {
                delete_row("person_attr_single", {person : this.uuid, key});
            }
        }

        // multi-value attributes: values have no key of their own, so a changed list drops its
        // container (which cascades to the values) and starts a new one. the new container
        // depends on that delete, so its values are new mutations even when they were there
        // before.
        for (const [key, values] of multi) {
            const current = cur_multi.get(key) ?? [];
            let target = values;
            if (base) {
                // the user's additions and removals, applied to what is stored now
                const before = clean_list(base[key]);
                const removed = before.filter((v) => ! values.includes(v));
                const added = values.filter((v) => ! before.includes(v));
                target = (removed.length === 0 && added.length === 0)
                        ? current // not changed by the user
                        : clean_list([...current.filter((v) => ! removed.includes(clean_text(v))),
                                       ...added ]);
            }

            if (! same_values(target, current)) {
                if (current.length > 0) {
                    delete_row("person_attr_multi", {person : this.uuid, key});
                }

                if (target.length > 0) {
                    (new AddPersonAttr({person : this.uuid, key})).process();
                    for (const value of target) {
                        (new AddPersonAttrValue({person : this.uuid, key, value})).process();
                    }
                }
            }

            if (LABELLED_ATTRS.includes(key)) {
                this.set_labels(key, target, cur_labels.get(key) ?? new Map(), base);
            }
        }

        // respond with the created/updated person
        soba.task.respond(new PutPersonResponse({
            uuid : this.uuid,
        }));
    }

    // Labels hang off the person, not the list's container, so a list replaced above keeps
    // them. Sets the labels of `values` (the list as this request leaves it) and deletes the
    // ones of values no longer in it. With a base, a label the user didn't change keeps what
    // is stored now.
    set_labels(key, values, stored, base) {
        const wanted = clean_labels(this.labels?.[key]);
        const before = base ? clean_labels(base.labels?.[key]) : null;
        for (const value of values) {
            let label = wanted.get(value) ?? "";
            if (before && label === (before.get(value) ?? "")) {
                label = stored.get(value) ?? "";
            }

            if (label && label !== stored.get(value)) {
                (new SetPersonAttrLabel({person : this.uuid, key, value, label})).process();
            }
            else if (! label && stored.has(value)) {
                delete_row("person_attr_label", {person : this.uuid, key, value});
            }
        }

        for (const value of stored.keys()) {
            if (! values.includes(value)) {
                delete_row("person_attr_label", {person : this.uuid, key, value});
            }
        }
    }
}

export class GetPeople {
    static KEY = `{${namespace}}${this.name}`;
    constructor({filter, tagFilter, limit = 500, offset = 0} = {}) {
        this.filter = filter;
        this.tagFilter = tagFilter;
        this.limit = limit;
        this.offset = offset;
    }

    // the uuids of the requested page, in display order. sqlite's LIKE and ORDER BY only fold
    // ascii, so matching and sorting happen in js.
    page() {
        let matches = null;
        if (this.filter) {
            const needle = fold(this.filter);
            matches = new Set();
            for (const [person, value] of query(QSTR_PERSON_VALUES)) {
                if (! matches.has(person) && fold(value ?? "").includes(needle)) {
                    matches.add(person);
                }
            }
        }

        return ordered_uuids(matches).slice(this.offset, this.offset + this.limit);
    }

    process() { soba.task.respond(new GetPeopleResponse({data : load_people(this.page())})); }
}

export class GetPerson {
    static KEY = `{${namespace}}${this.name}`;
    constructor({uuid} = {}) { this.uuid = uuid; }
    process() {
        if (! this.uuid) {
            return;
        }

        soba.task.respond(load_people([ this.uuid ])[0]);
    }
}

export class DeletePerson {
    static KEY = `{${namespace}}${this.name}`;
    constructor({uuid} = {}) {
        if (! uuid) {
            throw new MalformedObject("Missing Person.uuid");
        }
        this.uuid = uuid;
    }

    process() {
        // a find on a uuid that was never inserted throws and aborts the pass, so look first
        if (query("SELECT 1 FROM person WHERE uuid = ?", this.uuid).length === 0) {
            soba.log.warning(`No person ${this.uuid} to delete`);
            return;
        }
        delete_row("person", {uuid : this.uuid});
    }
}

// Mails a vCard file the UI wrote, as an attachment, to the addresses the UI gives. The
// backend makes nothing here: the UI writes the vCard, the subject and the text.
// process() takes the base module's Message and MessageAttachment from the Mutator,
// because this module can't import the base module: the UI bundles it too.
export class SendVCard {
    static KEY = `{${namespace}}${this.name}`;
    constructor({to = [], filename = "", vcard = "", subject = "", text = ""} = {}) {
        const recipients = (Array.isArray(to) ? to : [ to ]).map(clean_text).filter(Boolean);
        if (recipients.length === 0) {
            throw new MalformedObject("Missing SendVCard.to");
        }
        if (! clean_text(vcard)) {
            throw new MalformedObject("Missing SendVCard.vcard");
        }

        this.to = recipients;
        this.filename = clean_text(filename) || "contacts.vcf";
        this.vcard = String(vcard);
        this.subject = clean_text(subject) || "Contacts";
        this.text = clean_text(text) || "Attached: " + this.filename;
    }

    process({Message, MessageAttachment}) {
        const message = new Message();
        message.genUuid();
        message.from = [ {address : soba.app.account()} ];
        message.to = this.to.map((address) => ({address}));
        message.subject = this.subject;
        message.bodyText = this.text;
        // unlike the text body, an attachment's string isn't encoded for us
        message.attachments = [ new MessageAttachment({
            name : this.filename,
            type : "text/vcard",
            blobs : [ soba.text.encode(this.vcard).buffer ],
        }) ];
        soba.mail.send(message);

        soba.task.respond(new SendVCardResponse({to : this.to}));
    }
}

export class SendVCardResponse {
    static KEY = `{${namespace}}${this.name}`;
    constructor({to = []} = {}) { this.to = to; }
}

export class Person {
    static KEY = `{${namespace}}${this.name}`;
    constructor({
        uuid = "",
        firstName = "",
        lastName = "",
        jobTitle = "",
        company = "",
        emails = [],
        phones = [],
        tags = [],
        address = "",
        notes = "",
        labels = {},
    } = {}) {
        this.uuid = uuid;
        this.firstName = firstName;
        this.lastName = lastName;
        this.jobTitle = jobTitle;
        this.company = company;
        this.emails = emails;
        this.phones = phones;
        this.tags = tags;
        this.address = address;
        this.notes = notes;
        // {emails: {address: label}, phones: {number: label}}
        this.labels = labels;
    }
}

export class GetPeopleResponse {
    static KEY = `{${namespace}}${this.name}`;
    constructor({data = []} = {}) { this.data = data; }
}
