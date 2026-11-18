import {readFileSync} from "fs";
import {resolve} from "path";

// The backend's Application.version, read from the Mutator.mjs the UI ships with, so the
// UI can show it without a request. The vite configs define it as __MUTATOR_VERSION__.
export function mutatorVersion(): string {
    const src = readFileSync(resolve("../Mutator.mjs"), "utf8");
    const m = src.match(/static\s+version\s*=\s*"([^"]+)"/);
    if (! m) {
        throw new Error("Mutator.mjs has no static version");
    }
    return m[1];
}
