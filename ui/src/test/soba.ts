// A stand-in for the soba runtime, enough to run the contacts module's request
// handlers in tests. soba.db.exec runs on an in-memory SQLite (sql.js) holding
// the tables Mutator.mjs declares; soba.data.* emulate the runtime's lww
// replacement and fk cascades on them. Mutations, hashes and replication are
// not modelled.

/// <reference types="node" />
// (the app's tsconfig leaves node's types out; this brings them into the type check,
// for the test helpers that read files)

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type SqlValue } from "sql.js";

// handed over directly: under jsdom, sql.js would try to fetch its wasm like a browser
const WASM = readFileSync(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm"));

// Mirrors the soba.schema.table() calls in Mutator.mjs; keep the two in sync.
const DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE
);
CREATE TABLE person_attr_single (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL CHECK (key != ''),
    person TEXT NOT NULL REFERENCES person (uuid) ON DELETE CASCADE,
    value,
    UNIQUE (person, key)
);
CREATE TABLE person_attr_multi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL CHECK (key != ''),
    person TEXT NOT NULL REFERENCES person (uuid) ON DELETE CASCADE,
    UNIQUE (person, key)
);
CREATE TABLE person_attr_multi_value (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL CHECK (key != ''),
    person TEXT NOT NULL REFERENCES person (uuid) ON DELETE CASCADE,
    value,
    FOREIGN KEY (person, key) REFERENCES person_attr_multi (person, key)
        ON DELETE CASCADE
);
CREATE TABLE person_attr_label (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL CHECK (key != ''),
    label TEXT NOT NULL CHECK (label != ''),
    person TEXT NOT NULL REFERENCES person (uuid) ON DELETE CASCADE,
    value NOT NULL,
    UNIQUE (person, key, value)
);
`;

// the columns an insert takes from its object, and the lww key
const TABLES: Record<string, { columns: string[]; lww: string[] }> = {
    person: { columns: ["uuid"], lww: ["uuid"] },
    person_attr_single: { columns: ["person", "key", "value"], lww: ["person", "key"] },
    person_attr_multi: { columns: ["person", "key"], lww: ["person", "key"] },
    person_attr_multi_value: { columns: ["person", "key", "value"], lww: [] },
    person_attr_label: {
        columns: ["person", "key", "value", "label"],
        lww: ["person", "key", "value"],
    },
};

type Fields = Record<string, unknown>;

export type FakeSoba = {
    /** Runs a query on the instance database, for assertions. */
    sql(query: string, ...params: unknown[]): unknown[][];
    /** Processes a request object and returns what it responded, if anything. */
    run<T>(request: { process(): void }): T | undefined;
    /** The messages handed to soba.mail.send, in order. */
    sent: unknown[];
};

/** soba.app.account() of the stand-in. */
export const ACCOUNT = "me@example.com";

export async function install_fake_soba(): Promise<FakeSoba> {
    const SQL = await initSqlJs({
        wasmBinary: WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength) as ArrayBuffer,
    });
    const db = new SQL.Database();
    db.exec(DDL);

    const sql = (query: string, ...params: unknown[]) => {
        const stmt = db.prepare(query);
        try {
            stmt.bind(params as SqlValue[]);
            const rows: unknown[][] = [];
            while (stmt.step()) rows.push(stmt.get());
            return rows;
        } finally {
            stmt.free();
        }
    };
    const where = (columns: string[]) => columns.map((c) => `${c} = ?`).join(" AND ");

    let responses: unknown[] = [];
    let minted = 0;
    const sent: unknown[] = [];

    (globalThis as unknown as { soba: unknown }).soba = {
        app: { account: () => ACCOUNT },
        mail: { send: (message: unknown) => sent.push(message) },
        text: { encode: (s: string) => new TextEncoder().encode(s) },
        db: {
            exec: (query: string, ...params: unknown[]) => ({
                code: 0,
                data: sql(query, ...params),
            }),
        },
        data: {
            insert(table: string, object: Fields) {
                const { columns, lww } = TABLES[table];
                const values = columns.map((c) => object[c] ?? null);
                if (lww.length > 0) {
                    const old = sql(
                        `SELECT id, ${columns.join(", ")} FROM ${table} WHERE ${where(lww)}`,
                        ...lww.map((c) => object[c]),
                    )[0];
                    if (old) {
                        // the same content is ignored, other content replaces the row
                        if (columns.every((_, i) => old[i + 1] === values[i])) {
                            return { hash: old[0] };
                        }
                        sql(`DELETE FROM ${table} WHERE id = ?`, old[0]);
                    }
                }
                sql(
                    `INSERT INTO ${table} (${columns.join(", ")})
                     VALUES (${columns.map(() => "?").join(", ")})`,
                    ...values,
                );
                return { hash: sql("SELECT last_insert_rowid()")[0][0] };
            },
            find(table: string, key: Fields) {
                // like the runtime: exactly the columns of the lww constraint
                const { lww } = TABLES[table];
                const columns = Object.keys(key);
                if (
                    lww.length === 0 ||
                    columns.length !== lww.length ||
                    !lww.every((c) => columns.includes(c))
                ) {
                    throw new Error(`find on ${table} needs exactly [${lww}], got [${columns}]`);
                }
                const row = sql(
                    `SELECT id FROM ${table} WHERE ${where(columns)}`,
                    ...columns.map((c) => key[c]),
                )[0];
                if (!row) throw new Error(`no ${table} row for ${JSON.stringify(key)}`);
                return { object: key, hash: row[0], deleted: false };
            },
            delete(table: string, hash: unknown) {
                sql(`DELETE FROM ${table} WHERE id = ?`, hash);
            },
        },
        type: {
            uuid: {
                v4: () => `{00000000-0000-4000-8000-${String(++minted).padStart(12, "0")}}`,
            },
        },
        task: {
            respond: (object: unknown) => responses.push(object),
            emit() {},
        },
        log: { debug() {}, info() {}, warning() {}, error() {} },
    };

    return {
        sql,
        sent,
        run<T>(request: { process(): void }) {
            responses = [];
            request.process();
            return responses[0] as T | undefined;
        },
    };
}
