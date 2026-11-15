import { readFileSync, writeFileSync } from "node:fs";
import { DICTIONARIES } from "./dictionaries.mjs";

const dictionaries = Object.fromEntries(Object.keys(DICTIONARIES).map((id) => [
  id, readFileSync(new URL(`../dictionaries/${id}.txt`, import.meta.url), "utf8"),
]));
writeFileSync(
  new URL("dict-data.js", import.meta.url),
  `// Generated from ../dictionaries by build-dict-data.mjs\nexport const EMBEDDED_DICT_TEXT = ${JSON.stringify(dictionaries)};\n`,
);
