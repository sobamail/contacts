
/*
 * This is a Sobamail application.
 * See https://sobamail.com for more info
 */

import "soba://computer/R2";

import {
    DeleteRow,
    Message,
    MessageAttachment,
} from "https://sobamail.com/module/base/v1?sha224=FT31A9Ojcmu_lm2HSbwlKpw5FDVqfP2ESNjmrg";
import {
    AddPerson,
    AddPersonAttr,
    AddPersonAttrValue,
    DeletePerson,
    GetPeople,
    GetPerson,
    MalformedObject,
    PutPerson,
    SendVCard,
    SetPersonAttr,
    SetPersonAttrLabel,
} from "https://sobamail.com/module/contacts/v1?sha224=9F77Q615OJCAHF1KIOOEP68JL2BQTQ7BL74R4CGQAC3PO";

// what the module's mail-sending objects need from the base module, which it can't import
const MAIL = {
    Message,
    MessageAttachment
};

export default class Application {
    static id = "contacts.app.sobamail.com";
    static name = "Contacts";
    static version = "1.2.0.8";
    static objects = new Map([
        [ DeleteRow.KEY, false ],
        [ AddPerson.KEY, false ],
        [ SetPersonAttr.KEY, false ],
        [ AddPersonAttr.KEY, false ],
        [ AddPersonAttrValue.KEY, false ],
        [ SetPersonAttrLabel.KEY, false ],
        [ PutPerson.KEY, false ],
        [ DeletePerson.KEY, false ],

        [ GetPerson.KEY, false ],
        [ GetPeople.KEY, false ],
        [ SendVCard.KEY, false ],
    ]);

    static handlers = new Map([
        [ AddPerson.KEY, (content) => (new AddPerson(content)).process() ],
        [ SetPersonAttr.KEY, (content) => (new SetPersonAttr(content)).process() ],
        [ AddPersonAttr.KEY, (content) => (new AddPersonAttr(content)).process() ],
        [ AddPersonAttrValue.KEY, (content) => (new AddPersonAttrValue(content)).process() ],
        [ SetPersonAttrLabel.KEY, (content) => (new SetPersonAttrLabel(content)).process() ],
        [ PutPerson.KEY, (content) => (new PutPerson(content)).process() ],
        [ DeletePerson.KEY, (content) => (new DeletePerson(content)).process() ],

        [ GetPerson.KEY, (content) => (new GetPerson(content)).process() ],
        [ GetPeople.KEY, (content) => (new GetPeople(content)).process() ],
        [ SendVCard.KEY, (content) => (new SendVCard(content)).process(MAIL) ],
    ]);

    constructor() {
        soba.schema.table({
            name : "person",
            insertEvent : AddPerson,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "uuid",
                    checks : [
                        {op : "!=", value : null},
                        {op : "typeof", value : "text"},
                        {op : "lww", value : true},
                        {op : "regexp", value : soba.type.uuid.pattern},
                    ],
                },
            ],
        });

        soba.schema.table({
            name : "person_attr_single",
            insertEvent : SetPersonAttr,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "person",
                    checks : [
                        {op : "!=", value : null},
                        {op : "fk", table : "person", column : "uuid"},
                    ],
                },
                {
                    name : "key",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
                {
                    name : "value",
                    checks : [],
                },
            ],
            checks : [
                {
                    columns : [ "person", "key" ],
                    op : "lww",
                    value : true,
                },
            ],
        });

        soba.schema.table({
            name : "person_attr_multi",
            insertEvent : AddPersonAttr,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "person",
                    checks : [
                        {op : "!=", value : null},
                        {op : "fk", table : "person", column : "uuid"},
                    ],
                },
                {
                    name : "key",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
            ],
            checks : [
                {
                    columns : [ "person", "key" ],
                    op : "lww",
                    value : true,
                },
            ],
        });

        soba.schema.table({
            name : "person_attr_multi_value",
            insertEvent : AddPersonAttrValue,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "person",
                    checks : [
                        {op : "!=", value : null},
                    ],
                },
                {
                    name : "key",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
                {
                    name : "value",
                    checks : [],
                },
            ],
            checks : [
                {
                    columns : {person : "person", key : "key"},
                    op : "fk",
                    table : "person_attr_multi",
                },
            ],
        });

        // the label of one value in a list. keyed to the person, not to the list's container:
        // a changed list replaces its container, and labels of values that stay keep their row.
        soba.schema.table({
            name : "person_attr_label",
            insertEvent : SetPersonAttrLabel,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "person",
                    checks : [
                        {op : "!=", value : null},
                        {op : "fk", table : "person", column : "uuid"},
                    ],
                },
                {
                    name : "key",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
                {
                    name : "value",
                    checks : [
                        {op : "!=", value : null},
                    ],
                },
                {
                    name : "label",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
            ],
            checks : [
                {
                    columns : [ "person", "key", "value" ],
                    op : "lww",
                    value : true,
                },
            ],
        });
    }

    process(message, metadata) {
        soba.log.info(JSON.stringify(metadata));

        // only local deliveries (ui requests, tasks and their replays) may touch the address
        // book. anything that arrives by mail is refused.
        if (metadata.type !== "task" && metadata.type !== "task-replay") {
            soba.log.warning(`Rejected non-local delivery of type '${metadata.type}'`);
            return;
        }

        const object = Message.extractObject(message, metadata);
        if (! object) {
            soba.log.debug("Unrecognized content");
            return;
        }

        const key = `{${object.namespace}}${object.name}`;
        const handler = Application.handlers.get(key);
        if (! handler) {
            soba.log.warning(`No handler found for objkey='${key}', ignored`);
            return;
        }

        try {
            handler(object.content);
        }
        catch (e) {
            // a retry can't fix a malformed object; anything else may be fixed by replication
            if (e instanceof MalformedObject) {
                soba.log.error(`Dropped malformed objkey='${key}': ${e.message}`);
                return;
            }
            throw e;
        }
    }
}
