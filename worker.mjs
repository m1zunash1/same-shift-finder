import { EMBEDDED_DICT_TEXT } from "./dict-data.js";
import { DICTIONARIES } from "./dictionaries.mjs?v=3";
import { makeDictionary, searchPairs } from "./search.mjs?v=3";

const cache = new Map();

function browserDictionary(language, ids) {
  const applicable = ids.filter((id) => DICTIONARIES[id].language === language);
  const key = applicable.join(",");
  if (!cache.has(key)) {
    const entries = applicable.flatMap((id) => EMBEDDED_DICT_TEXT[id].split(/\r?\n/).map((word) => [word, id]));
    cache.set(key, makeDictionary(entries, language));
  }
  return cache.get(key);
}

self.onmessage = ({ data }) => {
  try {
    const [left, right] = data.inputs.map(({ language, text, ids }) => ({
      language,
      text,
      dictionary: browserDictionary(language, ids),
    }));
    const results = searchPairs(left, right, data.options);
    self.postMessage({ results });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
