import {GetPeopleResponse, namespace, Person, PutPersonResponse} from "$module/contacts/v1";
import {ResponseCompact} from "$lib/Response";
import * as msgpack from "@msgpack/msgpack";

// msgpack.encode returns Uint8Array<ArrayBufferLike>; TS 5.7+ pinned the DOM's
// BodyInit to ArrayBuffer-backed views. The bytes are a valid fetch body at
// runtime, so we assert the type at this single boundary.
const mpBody = (o: unknown): BodyInit => msgpack.encode(o) as unknown as BodyInit;

// Posts one object to the backend. Returns its response, or null when it responded
// nothing; a response carrying an error throws.
async function request(name: string, content: object): Promise<ResponseCompact|null> {
    const resp = await fetch("/api/v2/object", {
        method : "POST",
        headers : {
            "Content-Type" : "application/msgpack",
        },
        body : mpBody({namespace, name, content}),
    });

    if (! resp.ok) {
        throw new Error(resp.statusText + " (" + resp.status + ")");
    }

    const arrbuf = await resp.arrayBuffer();
    if (arrbuf.byteLength === 0) {
        return null;
    }

    const response = new ResponseCompact(arrbuf);
    if (response.error) {
        const error = response.error;
        throw new Error(typeof error === "string" ? error : JSON.stringify(error));
    }
    return response;
}

export async function read_people(
        filter: string, tagFilter: string[], limit: number, offset: number): Promise<Person[]> {
    const response = await request("GetPeople", {filter, tagFilter, limit, offset});
    const data = (response?.content as GetPeopleResponse|undefined)?.data ?? [];
    return data.map((o: Person) => new Person(o));
}

export async function read_person(uuid: string): Promise<Person|null> {
    const response = await request("GetPerson", {uuid});
    return response ? new Person(response.content as Person) : null;
}

// The tag Sobamail's send-time collect gives the addresses the user writes to; it keeps the
// name of a person carrying it current with the mail. An edit here makes the person the
// user's, so saving one drops the tag (owner, 2026-10-19).
export const TAG_REPLIED = "Replied";

// `base` is the person as the edit form loaded it: the backend then applies only what
// changed against it. Without one, the person replaces the stored one.
export async function put_person(person: Person, base: Person|null = null) {
    const response = await request("PutPerson", {...person, base});
    if (! response) {
        console.error("empty response");
        return;
    }

    return new PutPersonResponse({uuid : (response.content as PutPersonResponse).uuid});
}

// Mails `vcard`, written here, as an attachment to the `to` addresses. The backend only
// sends what it is given.
export async function send_vcard(
        to: string[], filename: string, vcard: string, subject: string, text: string) {
    await request("SendVCard", {to, filename, vcard, subject, text});
}

export async function delete_person(uuid: string) {
    await request("DeletePerson", {uuid});
    return true;
}
