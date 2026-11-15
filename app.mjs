import { detectInput, normalize } from "./search.mjs?v=3";
import { DICTIONARIES } from "./dictionaries.mjs?v=3";

const find = (id) => document.getElementById(id);
const form = find("search-form");
const status = find("status");
const alert = find("error");
const panel = document.querySelector(".results");
const resultsContainer = find("results");
const sides = ["a", "b"];
const pageSize = 50;
const integer = new Intl.NumberFormat("ja");
const languageLabels = { ja: "日本語", en: "英語・ローマ字" };
const defaultHint = "同じ長さのかな・英字を入力してください。";
const displayStep = (step) => step > 0 ? `+${step}` : step < 0 ? `−${Math.abs(step)}` : "0";

let worker = null;
let working = false;
let results = [];
let filtered = [];
let sources = [];
let visible = 0;
let lastSearch = null;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function dictionaryNames(entry) {
  return entry.dictionaries.map((id) => DICTIONARIES[id].label);
}

function renderRow({ left, right, shifts }) {
  const row = element("details", "result-row");
  const summary = element("summary", "result-grid");
  const words = [left, right];
  for (const entry of words) {
    const word = element("span", "word");
    const dictionaries = element("small", "dictionary-names");
    for (const name of dictionaryNames(entry)) dictionaries.append(element("span", "", name));
    word.append(element("strong", "", entry.word), dictionaries);
    summary.append(word);
  }
  const steps = element("span", "shifts");
  for (const step of shifts) steps.append(element("span", "shift", displayStep(step)));
  const disclosure = element("span", "disclosure");
  disclosure.append(element("span", "disclosure-open", "内訳を見る"), element("span", "disclosure-close", "閉じる"));
  summary.append(steps, disclosure);
  const moves = element("div", "moves");
  const legend = element("div", "move-key");
  legend.append(
    element("span", "", "共通シフト"),
    element("span", "column-a", "文字列1"),
    element("span", "column-b", "文字列2"),
  );
  const track = element("div", "move-track");
  shifts.forEach((step, i) => {
    const position = element("div", "move-position");
    position.append(element("span", "shift", displayStep(step)));
    words.forEach((entry, side) => {
      const change = element("span", `move-cell column-${sides[side]}`);
      change.append(
        element("span", "", sources[side][i]),
        element("span", "move-arrow", "→"),
        element("strong", "", entry.word[i]),
      );
      position.append(change);
    });
    track.append(position);
  });
  moves.append(legend, track);
  row.append(summary, moves);
  return row;
}

function applyFilter() {
  const query = find("result-filter").value;
  const kana = normalize(query, "ja");
  const latin = normalize(query, "en");
  filtered = results.filter(({ left, right }) =>
    [left.word, right.word].some((word) => word.includes(kana) || word.includes(latin))
  );
  visible = 0;
  resultsContainer.replaceChildren();
  showMore();
}

function showMore() {
  const slice = filtered.slice(visible, visible + pageSize);
  const fragment = document.createDocumentFragment();
  for (const result of slice) fragment.append(renderRow(result));
  resultsContainer.append(fragment);
  visible += slice.length;
  const count = integer.format(filtered.length);
  status.hidden = results.length === 0;
  status.textContent = filtered.length === results.length
    ? `${count}件`
    : `${count}件 / 全${integer.format(results.length)}件`;
  find("columns").hidden = filtered.length === 0;
  find("result-tools").hidden = results.length === 0;
  find("results-footer").hidden = visible >= filtered.length;
  if (visible < filtered.length) {
    find("load-more").textContent = `さらに${Math.min(pageSize, filtered.length - visible)}件表示`;
  }
  const empty = find("empty");
  empty.hidden = filtered.length > 0;
  empty.textContent = results.length > 0 ? "この単語を含む結果はありません。" : "条件に合う組がありませんでした。";
}

function stopSearch() {
  if (working) {
    worker.terminate();
    worker = null;
  }
  working = false;
  panel.setAttribute("aria-busy", "false");
  find("search").removeAttribute("aria-busy");
}

function showError(message) {
  alert.textContent = message;
  alert.hidden = false;
  find("empty").textContent = "検索条件を確認してください。";
}

function readInputs() {
  return sides.map((side) => {
    const input = detectInput(find(`text-${side}`).value);
    const ids = [...find(`dict-${side}`).querySelectorAll("input:checked")]
      .map((checkbox) => checkbox.value)
      .filter((id) => DICTIONARIES[id].language === input.language);
    return { ...input, ids };
  });
}

function readSearch() {
  return {
    inputs: readInputs(),
    options: {
      min: find("min").valueAsNumber,
      max: find("max").valueAsNumber,
      loop: find("loop").checked,
    },
  };
}

function updateSearchState() {
  find("stale").hidden = lastSearch === null || lastSearch === JSON.stringify(readSearch());
}

function updateInputMeta() {
  alert.hidden = true;
  const inputs = readInputs();
  inputs.forEach(({ language, text }, index) => {
    const side = sides[index];
    const indicator = find(`language-${side}`);
    indicator.hidden = !language;
    indicator.textContent = language ? `${languageLabels[language]} · ${text.length}文字` : "";
    find(`text-${side}`).setAttribute("aria-invalid", String(Boolean(text && !language)));
    for (const group of find(`dict-${side}`).querySelectorAll("[data-language]")) {
      group.hidden = Boolean(language && group.dataset.language !== language);
    }
  });

  const meta = find("input-meta");
  find("swap").disabled = inputs.every(({ text }) => !text);
  const invalid = inputs.some(({ language, text }) => text && !language);
  const mismatch = inputs.every(({ language }) => language) && inputs[0].text.length !== inputs[1].text.length;
  meta.dataset.error = String(invalid || mismatch);
  meta.textContent = invalid ? "各欄に、対応するかなだけか英字だけを入力してください。" :
    mismatch ? `文字数が異なります（${inputs[0].text.length}文字 / ${inputs[1].text.length}文字）。` : defaultHint;
  meta.hidden = !invalid && !mismatch && inputs.every(({ language }) => language);
}

function runSearch(event) {
  event.preventDefault();
  stopSearch();
  alert.hidden = true;

  try {
    const search = readSearch();
    const { inputs, options: { min, max } } = search;
    inputs.forEach(({ language, ids }, index) => {
      if (!language) {
        find(`text-${sides[index]}`).focus();
        throw new Error(`文字列${index + 1}には、対応するかなだけか英字だけを入力してください。`);
      }
      if (ids.length === 0) {
        find(`dict-${sides[index]}`).querySelector(`[data-language="${language}"] input`).focus();
        throw new Error(`文字列${index + 1}に使う辞書を選んでください（${languageLabels[language]}）。`);
      }
    });
    if (inputs[0].text.length !== inputs[1].text.length) {
      find("text-b").focus();
      throw new Error("2つの文字列を同じ長さにしてください。");
    }
    if (min > max) {
      find("min").focus();
      throw new Error("シフトの最小値は最大値以下にしてください。");
    }

    results = [];
    filtered = [];
    find("result-filter").value = "";
    lastSearch = null;
    updateSearchState();
    visible = 0;
    resultsContainer.replaceChildren();
    for (const id of ["columns", "results-footer", "result-tools", "status"]) find(id).hidden = true;
    const empty = find("empty");
    empty.hidden = false;
    empty.textContent = "検索中…";
    sources = inputs.map(({ text }) => text);

    worker ??= new Worker(new URL("./worker.mjs?v=5", import.meta.url), { type: "module" });
    const currentWorker = worker;
    working = true;
    panel.setAttribute("aria-busy", "true");
    find("search").setAttribute("aria-busy", "true");
    worker.onmessage = ({ data }) => {
      if (worker !== currentWorker) return;
      working = false;
      stopSearch();
      if (data.error) {
        showError(data.error);
        return;
      }
      results = data.results;
      lastSearch = JSON.stringify(search);
      applyFilter();
      updateSearchState();
    };
    worker.onerror = () => {
      if (worker !== currentWorker) return;
      stopSearch();
      showError("辞書データを読み込めませんでした。ページを再読み込みしてください。");
    };
    worker.postMessage(search);
  } catch (error) {
    stopSearch();
    showError(error.message);
  }
}

function updatePresets() {
  const { options: { min, max } } = readSearch();
  for (const button of form.querySelectorAll("[data-range]")) {
    const range = Number(button.dataset.range);
    button.setAttribute("aria-pressed", String(min === -range && max === range));
  }
}

form.addEventListener("submit", runSearch);
form.addEventListener("input", (event) => {
  if (event.target.id === "min" || event.target.id === "max") updatePresets();
  updateSearchState();
});

for (const button of form.querySelectorAll("[data-range]")) {
  button.addEventListener("click", () => {
    const range = Number(button.dataset.range);
    find("min").value = -range;
    find("max").value = range;
    updatePresets();
    updateSearchState();
    alert.hidden = true;
  });
}

find("swap").addEventListener("click", () => {
  const left = find("text-a");
  const right = find("text-b");
  [left.value, right.value] = [right.value, left.value];
  for (const checkbox of find("dict-a").querySelectorAll("input")) {
    const opposite = find("dict-b").querySelector(`input[value="${checkbox.value}"]`);
    [checkbox.checked, opposite.checked] = [opposite.checked, checkbox.checked];
  }
  updateInputMeta();
  updateSearchState();
});
for (const side of sides) {
  const dictionaries = find(`dict-${side}`);
  for (const [id, { language, label }] of Object.entries(DICTIONARIES)) {
    const option = element("label");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.value = id;
    checkbox.defaultChecked = id !== "roma";
    option.append(checkbox, document.createTextNode(label));
    dictionaries.querySelector(`[data-language="${language}"]`).append(option);
  }
  find(`text-${side}`).addEventListener("input", updateInputMeta);
}
updateInputMeta();
find("result-filter").addEventListener("input", applyFilter);
find("load-more").addEventListener("click", () => {
  const previousCount = visible;
  showMore();
  resultsContainer.children[previousCount]?.querySelector("summary").focus({ preventScroll: true });
});
find("download").addEventListener("click", () => {
  const lines = results.map(({ left, right, shifts }) =>
    [left.word, right.word, shifts.join(", "), dictionaryNames(left).join(" / "), dictionaryNames(right).join(" / ")].join("\t")
  );
  const file = new Blob(["\uFEFF", "結果1\t結果2\tシフト\t辞書1\t辞書2\n", lines.join("\n"), "\n"],
    { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = element("a");
  link.href = url;
  link.download = "共通シフト検索.tsv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
