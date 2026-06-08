// The app's backend for component tests: fetch("/api/v2/object") is routed to the
// contacts module's request objects, which run on the stand-in runtime (soba.ts). So a
// component test drives the UI, model.ts and the module together; only the runtime and
// the host are stand-ins.

import { decode, encode } from "@msgpack/msgpack";
import { vi } from "vitest";
import {
    DeletePerson,
    GetPeople,
    GetPerson,
    PutPerson,
    SendVCard,
    namespace,
} from "$module/contacts/v1";
import { install_fake_soba, type FakeSoba } from "./soba";

// stand-ins for the base module's mail classes, which the Mutator hands to SendVCard
export class FakeMessage {
    uuid = "";
    from: unknown;
    to: unknown;
    subject = "";
    bodyText = "";
    attachments: FakeAttachment[] = [];
    genUuid() {
        this.uuid = "{generated}";
    }
}
export class FakeAttachment {
    constructor(public init: { name: string; type: string; blobs: ArrayBuffer[] }) {}
}
const MAIL = { Message: FakeMessage, MessageAttachment: FakeAttachment };

// the requests the Mutator's handlers take from the UI
const REQUESTS: Record<string, new (content: never) => { process(mail?: unknown): void }> = {
    DeletePerson,
    GetPeople,
    GetPerson,
    PutPerson,
    SendVCard,
};

export type Backend = { soba: FakeSoba; fetch: ReturnType<typeof vi.fn> };

/** Installs the stand-in runtime and a fetch that serves /api/v2/object from it. */
export async function install_backend(): Promise<Backend> {
    const soba = await install_fake_soba();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const request = decode(init.body as Uint8Array) as {
            name: string;
            content: never;
        };
        const Request = REQUESTS[request.name];
        if (!Request) return new Response(null, { status: 404 });

        const object = new Request(request.content);
        const response = soba.run<object>({ process: () => object.process(MAIL) });
        if (!response) return new Response(null);
        // the compact SMC the runtime answers with: 0 namespace, 1 name, 3 content
        const body = encode({ 0: namespace, 1: response.constructor.name, 3: { ...response } });
        return new Response(body as unknown as BodyInit);
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    return { soba, fetch };
}
