// watch_people and watch_presence against a stand-in EventSource: which events they listen
// to, how a burst folds into one call, the statuses read off the presence events, and
// reopening a stream the browser gave up on.

import { decode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { namespace } from "$module/contacts/v1";
import { CHANGE_KEYS, PRESENCE_KEY, watch_people, watch_presence } from "$lib/model";

class FakeEventSource extends EventTarget {
    static CLOSED = 2;
    static all: FakeEventSource[] = [];
    readyState = 1;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
        super();
        FakeEventSource.all.push(this);
    }
    close() {
        this.readyState = FakeEventSource.CLOSED;
    }
    emit(type: string, data?: string) {
        this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data }));
    }
}

const last = () => FakeEventSource.all[FakeEventSource.all.length - 1];

beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.all = [];
    vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("watch_people", () => {
    it("listens on the app's event stream", () => {
        watch_people(() => {});
        expect(FakeEventSource.all.map((e) => e.url)).toEqual(["/api/v2/event"]);
    });

    it("folds a burst of mutations into one call", () => {
        const onChange = vi.fn();
        watch_people(onChange, 100);
        for (const k of CHANGE_KEYS) last().emit(k);
        last().emit(CHANGE_KEYS[0]); // a repeat, as at-least-once delivery allows
        expect(onChange).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("hears a delete", () => {
        const onChange = vi.fn();
        watch_people(onChange, 0);
        last().emit("{https://sobamail.com/module/base/v1}DeleteRow");
        vi.runAllTimers();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("ignores other events", () => {
        const onChange = vi.fn();
        watch_people(onChange, 0);
        last().emit("message");
        last().emit("{https://example.com/other/v1}AddThing");
        vi.runAllTimers();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("reopens a closed stream and rereads once it is open", () => {
        const onChange = vi.fn();
        watch_people(onChange, 0);
        const first = last();
        first.close();
        first.onerror!();
        vi.advanceTimersByTime(5000);
        expect(FakeEventSource.all).toHaveLength(2);
        last().emit("open");
        vi.runAllTimers();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("leaves a stream the browser is retrying to the browser", () => {
        watch_people(() => {});
        last().readyState = 0; // CONNECTING
        last().onerror!();
        vi.advanceTimersByTime(10000);
        expect(FakeEventSource.all).toHaveLength(1);
    });

    it("stops", () => {
        const onChange = vi.fn();
        const stop = watch_people(onChange, 100);
        last().emit(CHANGE_KEYS[0]);
        stop();
        vi.runAllTimers();
        expect(onChange).not.toHaveBeenCalled();
        expect(last().readyState).toBe(FakeEventSource.CLOSED);
    });

    it("ignores presence", () => {
        const onChange = vi.fn();
        watch_people(onChange, 0);
        last().emit(PRESENCE_KEY, status("ann@acme.com", 2));
        vi.runAllTimers();
        expect(onChange).not.toHaveBeenCalled();
    });
});

// a PresenceStatus event's data, as the host writes it
const status = (address: string, state: number) =>
    JSON.stringify({
        content: { address, state },
        name: "PresenceStatus",
        namespace: "https://sobamail.com/module/base/v1",
    });

describe("watch_presence", () => {
    // the objects posted to /api/v2/object, by name
    let posted: { namespace: string; name: string }[];

    beforeEach(() => {
        posted = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init: RequestInit) => {
                posted.push(decode(init.body as Uint8Array) as { namespace: string; name: string });
                return new Response(null, { status: 202 });
            }),
        );
    });

    it("listens for the host's PresenceStatus on the app's event stream", () => {
        watch_presence(() => {});
        expect(PRESENCE_KEY).toBe("{https://sobamail.com/module/base/v1}PresenceStatus");
        expect(FakeEventSource.all.map((e) => e.url)).toEqual(["/api/v2/event"]);
    });

    it("asks for the colleagues online each time the stream opens", async () => {
        watch_presence(() => {});
        expect(posted).toEqual([]);
        last().emit("open");
        await vi.waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].namespace).toBe(namespace);
        expect(posted[0].name).toBe("GetOnlineUsers");

        // the browser reconnected by itself: a new session, asked again
        last().emit("open");
        await vi.waitFor(() => expect(posted).toHaveLength(2));
    });

    it("reports each status, the address lowercased, unknown as none", () => {
        const onStatus = vi.fn();
        watch_presence(onStatus);
        last().emit(PRESENCE_KEY, status("Ann@Acme.com", 2));
        last().emit(PRESENCE_KEY, status("bob@acme.com", 1));
        last().emit(PRESENCE_KEY, status("ann@acme.com", 0));
        expect(onStatus.mock.calls).toEqual([
            ["ann@acme.com", "online"],
            ["bob@acme.com", "offline"],
            ["ann@acme.com", null],
        ]);
    });

    it("skips an event it cannot read", () => {
        const onStatus = vi.fn();
        watch_presence(onStatus);
        last().emit(PRESENCE_KEY, "not json");
        last().emit(PRESENCE_KEY, JSON.stringify({ content: { state: 2 } }));
        last().emit(PRESENCE_KEY, status("", 2));
        last().emit(PRESENCE_KEY, JSON.stringify(null));
        expect(onStatus).not.toHaveBeenCalled();
    });

    it("reopens a closed stream", () => {
        const onStatus = vi.fn();
        watch_presence(onStatus);
        const first = last();
        first.close();
        first.onerror!();
        vi.advanceTimersByTime(5000);
        expect(FakeEventSource.all).toHaveLength(2);
        last().emit(PRESENCE_KEY, status("ann@acme.com", 2));
        expect(onStatus).toHaveBeenCalledWith("ann@acme.com", "online");
    });

    it("stops", () => {
        const onStatus = vi.fn();
        const stop = watch_presence(onStatus);
        stop();
        expect(last().readyState).toBe(FakeEventSource.CLOSED);
        last().onerror!();
        vi.advanceTimersByTime(10000);
        expect(FakeEventSource.all).toHaveLength(1);
    });
});
