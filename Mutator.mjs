
/*
 * This is a Sobamail application.
 * See https://sobamail.com for more info
 */

import "soba://computer/R2";

import {
    DeleteRow,
    Message,
    MessageAttachment,
} from "https://sobamail.com/module/base/v1?sha224=Vj_Th4VBElplcMExD0auypOwjcxuRw7RhvfbaA";
import {
    AddGroup,
    AddGroupMember,
    AddPerson,
    AddPersonAttr,
    AddPersonAttrValue,
    DeletePerson,
    DelGroup,
    DelGroupMember,
    GetGroupMembers,
    GetGroups,
    GetPeople,
    GetPerson,
    GetTags,
    Group,
    GroupAttr,
    GroupMember,
    mailed_object,
    MalformedObject,
    PutPerson,
    SendVCard,
    SetAttrGroup,
    SetPersonAttr,
    SetPersonAttrLabel,
    UnsetAttrGroup,
} from "https://sobamail.com/module/contacts/v1?sha224=nxnORq-KriZyvnBAMQMzyo6kwQ4M8a052hCpoA";

// what the module's mail-sending objects need from the base module, which it can't import
const MAIL = {
    Message,
    MessageAttachment
};

export default class Application {
    static id = "contacts.app.sobamail.com";
    static name = "Contacts";
    static version = "1.6.1.16";
    static objects = new Map([
        [ DeleteRow.KEY, false ],
        [ AddPerson.KEY, false ],
        [ SetPersonAttr.KEY, false ],
        [ AddPersonAttr.KEY, false ],
        [ AddPersonAttrValue.KEY, false ],
        [ SetPersonAttrLabel.KEY, false ],
        [ PutPerson.KEY, false ],
        [ DeletePerson.KEY, false ],

        [ Group.KEY, false ],
        [ GroupAttr.KEY, false ],
        [ GroupMember.KEY, false ],
        [ AddGroup.KEY, false ],
        [ DelGroup.KEY, false ],
        [ SetAttrGroup.KEY, false ],
        [ UnsetAttrGroup.KEY, false ],
        [ AddGroupMember.KEY, false ],
        [ DelGroupMember.KEY, false ],

        [ GetPerson.KEY, false ],
        [ GetPeople.KEY, false ],
        [ GetTags.KEY, false ],
        [ GetGroups.KEY, false ],
        [ GetGroupMembers.KEY, false ],
        [ SendVCard.KEY, false ],

        // the host's broadcast of a colleague's online status, which reaches the event
        // stream of the apps that list it here; base has no class for it to take the key of
        [ "{https://sobamail.com/module/base/v1}PresenceStatus", false ],
    ]);

    static handlers = new Map([
        [ AddPerson.KEY, (content) => (new AddPerson(content)).process() ],
        [ SetPersonAttr.KEY, (content) => (new SetPersonAttr(content)).process() ],
        [ AddPersonAttr.KEY, (content) => (new AddPersonAttr(content)).process() ],
        [ AddPersonAttrValue.KEY, (content) => (new AddPersonAttrValue(content)).process() ],
        [ SetPersonAttrLabel.KEY, (content) => (new SetPersonAttrLabel(content)).process() ],
        [ PutPerson.KEY, (content) => (new PutPerson(content)).process() ],
        [ DeletePerson.KEY, (content) => (new DeletePerson(content)).process() ],

        [ Group.KEY, (content) => (new Group(content)).process() ],
        [ GroupAttr.KEY, (content) => (new GroupAttr(content)).process() ],
        [ GroupMember.KEY, (content) => (new GroupMember(content)).process() ],
        [ AddGroup.KEY, (content) => (new AddGroup(content)).process() ],
        [ DelGroup.KEY, (content) => (new DelGroup(content)).process() ],
        [ SetAttrGroup.KEY, (content) => (new SetAttrGroup(content)).process() ],
        [ UnsetAttrGroup.KEY, (content) => (new UnsetAttrGroup(content)).process() ],
        [ AddGroupMember.KEY, (content) => (new AddGroupMember(content)).process() ],
        [ DelGroupMember.KEY, (content) => (new DelGroupMember(content)).process() ],

        [ GetPerson.KEY, (content) => (new GetPerson(content)).process() ],
        [ GetPeople.KEY, (content) => (new GetPeople(content)).process() ],
        [ GetTags.KEY, (content) => (new GetTags(content)).process() ],
        [ GetGroups.KEY, (content) => (new GetGroups(content)).process() ],
        [ GetGroupMembers.KEY, (content) => (new GetGroupMembers(content)).process() ],
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

        // groups (v1.mjs): circles of people keyed by a uuid, mailed by the server
        soba.schema.table({
            name : "grp",
            insertEvent : Group,
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
            name : "group_attr",
            insertEvent : GroupAttr,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "grp",
                    checks : [
                        {op : "!=", value : null},
                        {op : "fk", table : "grp", column : "uuid"},
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
                    columns : [ "grp", "key" ],
                    op : "lww",
                    value : true,
                },
            ],
        });

        soba.schema.table({
            name : "group_member",
            insertEvent : GroupMember,
            deleteEvent : DeleteRow,
            columns : [
                {
                    name : "grp",
                    checks : [
                        {op : "!=", value : null},
                        {op : "fk", table : "grp", column : "uuid"},
                    ],
                },
                {
                    name : "address",
                    checks : [
                        {op : "!=", value : null},
                        {op : "!=", value : ""},
                        {op : "typeof", value : "text"},
                    ],
                },
            ],
            checks : [
                {
                    columns : [ "grp", "address" ],
                    op : "lww",
                    value : true,
                },
            ],
        });
    }

    process(message, metadata) {
        soba.log.info(JSON.stringify(metadata));

        // local deliveries (ui requests, tasks and their replays) may touch the address book.
        // by mail, only the server's group objects and colleague cards are taken
        // (mailed_object() in v1.mjs).
        let object = null;
        if (metadata.type === "message") {
            if (metadata.location === "limbo") {
                return;
            }
            object = mailed_object(message);
            if (! object) {
                return;
            }
        }
        else if (metadata.type === "task" || metadata.type === "task-replay") {
            object = Message.extractObject(message, metadata);
        }
        else {
            soba.log.warning(`Rejected delivery of type '${metadata.type}'`);
            return;
        }

        if (! object) {
            soba.log.debug("Unrecognized content");
            return;
        }

        const key = `{${object.namespace}}${object.name}`;
        // a mailed PutPerson is the server's colleague card, not a ui request (v1.mjs)
        const handler = (metadata.type === "message" && key === PutPerson.KEY)
                ? (content) => (new PutPerson(content)).process({mailed : true})
                : Application.handlers.get(key);
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
