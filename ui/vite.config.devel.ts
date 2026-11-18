import {svelte} from "@sveltejs/vite-plugin-svelte";
import {resolve} from "path";
import {defineConfig} from "vite";

import {mutatorVersion} from "./mutator-version";

export default defineConfig({
    plugins : [ svelte() ],
    define : {
        __MUTATOR_VERSION__ : JSON.stringify(mutatorVersion()),
    },
    build : {
        minify : false,
        outDir : "../assets",
        emptyOutDir : true,
    },
    resolve : {
        alias : {
            $lib : resolve("./src/lib"),
            $module : resolve("../sobamail.com/module"),
        }
    }
});
