// watch_people against a stand-in EventSource: which events it listens to, how a burst
// folds into one call, and reopening a stream the browser gave up on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGE_KEYS, watch_people } from "$lib/model";

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
    emit(type: string) {
        this.dispatchEvent(new Event(type));
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
});
