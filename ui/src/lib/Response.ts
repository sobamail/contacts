// Shared with soba-mbmgr (user/ui and dept/ui, src/lib/Response.ts), with two changes:
// the constructor doesn't console.log every response (here that would be contact data),
// and there is an `error` getter. Fold both into the other copies to make the three
// identical again.

import {decode} from "@msgpack/msgpack";

export enum KeyMsgpack {
    AppInstanceId = 7,
    AppVersion = 8,
    Content = 3,
    ContentAux = 4,
    ContentParent = 5,
    DigestAlgo = 10,
    DigestMutator = 14,
    DigestValue = 9,
    DigestValueParent = 11,
    Error = 2,
    MailboxUuid = 13,
    MutationId = 12,
    Name = 1,
    Namespace = 0,
    WellKnownObject = 6,

    // Envelope
    Format = 64,
    ContentBytes = 64 + 1,
    Signature = 64 + 2,
    Sender = 64 + 3,
}

export enum KeyJson {
    AppInstanceId = "instanceId",
    AppVersion = "version",
    Content = "content",
    ContentAux = "contentAux",
    ContentParent = "contentParent",
    DigestAlgo = "digestAlgo",
    DigestMutator = "digestMutator",
    DigestValue = "digest",
    DigestValueParent = "digestParent",
    Error = "error",
    MailboxUuid = "mailbox",
    MutationId = "mutationId",
    Name = "name",
    Namespace = "namespace",
    WellKnownObject = "wellKnownObject",

    // Envelope
    Format = "format",
    ContentBytes = "contentBytes",
    Signature = "signature",
    Sender = "sender",
}

// Compact StructuredMessageContent definition
// Typically used in Msgpack serialization
export type SmcCompact = {
    [KeyMsgpack.Namespace]: string,
    [KeyMsgpack.Name]: string,
    [KeyMsgpack.Error]?: any,
    [KeyMsgpack.Content]?: any[]|object|null,
    [KeyMsgpack.ContentAux]?: any[]|object|null,
    [KeyMsgpack.ContentParent]?: any[]|object|null,
    [KeyMsgpack.WellKnownObject]?: number, // integer
    [KeyMsgpack.AppInstanceId]?: string,
    [KeyMsgpack.AppVersion]?: string,
    [KeyMsgpack.DigestValue]?: ArrayBuffer,
    [KeyMsgpack.DigestAlgo]?: string,
    [KeyMsgpack.DigestValueParent]?: ArrayBuffer,
    [KeyMsgpack.MutationId]?: bigint, // int64_t
    [KeyMsgpack.MailboxUuid]?: string,
    [KeyMsgpack.DigestMutator]?: ArrayBuffer,
};

// Pretty StructuredMessageContent definition
// Typically used in JSON serialization
export type SmcPretty = {
    [KeyJson.Namespace]: string,
    [KeyJson.Name]: string,
    [KeyJson.Error]?: any,
    [KeyJson.Content]?: any[]|object|null,
    [KeyJson.ContentAux]?: any[]|object|null,
    [KeyJson.ContentParent]?: any[]|object|null,
    [KeyJson.WellKnownObject]?: number, // integer
    [KeyJson.AppInstanceId]?: string,
    [KeyJson.AppVersion]?: string,
    [KeyJson.DigestValue]?: ArrayBuffer,
    [KeyJson.DigestAlgo]?: string,
    [KeyJson.DigestValueParent]?: ArrayBuffer,
    [KeyJson.MutationId]?: bigint, // int64_t
    [KeyJson.MailboxUuid]?: string,
    [KeyJson.DigestMutator]?: ArrayBuffer,
};

export class ResponseCompact {
    #object: SmcCompact|null = null;

    constructor(arrbuf: ArrayBuffer) {
        const object = decode(new Uint8Array(arrbuf)) as SmcCompact;
        if (object) {
            this.#object = object;
        }
    }

    get namespace(): string|null|undefined {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.Namespace];
    }

    get name(): string|null|undefined {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.Name];
    }

    get error(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.Error];
    }

    get content(): any[]|object|null|undefined {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.Content];
    }

    get contentAux(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.ContentAux];
    }

    get contentParent(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.ContentParent];
    }

    get wellKnownObject(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.WellKnownObject];
    }

    get appInstanceId(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.AppInstanceId];
    }

    get appVersion(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.AppVersion];
    }

    get digestValue(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.DigestValue];
    }

    get digestAlgo(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.DigestAlgo];
    }

    get digestValueParent(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.DigestValueParent];
    }

    get mutationId(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.MutationId];
    }

    get MailboxUuid(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.MailboxUuid];
    }

    get DigestMutator(): any {
        if (! this.#object) {
            return undefined;
        }
        return this.#object[KeyMsgpack.DigestMutator];
    }
}

// TODO: ResponsePretty
