import { describe, expect, it } from "vitest";
import { encode } from "@msgpack/msgpack";
import { ResponseCompact } from "./Response";

const bytes = (o: unknown) => {
    const b = encode(o);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("ResponseCompact", () => {
    it("reads the compact keys, the error included", () => {
        const r = new ResponseCompact(
            bytes({ 0: "urn:ns", 1: "GetPerson", 2: "no such person", 3: { uuid: "{x}" } }),
        );
        expect(r.namespace).toBe("urn:ns");
        expect(r.name).toBe("GetPerson");
        expect(r.error).toBe("no such person");
        expect(r.content).toEqual({ uuid: "{x}" });
    });

    it("has no error on a plain response", () => {
        expect(new ResponseCompact(bytes({ 0: "urn:ns", 1: "X", 3: {} })).error).toBeUndefined();
    });
});
