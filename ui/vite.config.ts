import {svelte} from "@sveltejs/vite-plugin-svelte";
import {resolve} from "path";
import {defineConfig} from "vite";

import {mutatorVersion} from "./mutator-version";

// https://vite.dev/config/
export default defineConfig({
  // the release build goes where the runtime serves the UI from, as dev-watch's does
  build: {
    outDir: '../assets',
    emptyOutDir: true,
  },
    plugins : [ svelte() ],
    define : {
        __MUTATOR_VERSION__ : JSON.stringify(mutatorVersion()),
    },
    resolve : {
        alias : {
            $lib : resolve("./src/lib"),
            $module : resolve("../sobamail.com/module"),
        }
    }
});
