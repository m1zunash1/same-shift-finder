export const ALPHABETS = {
  ja: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
  en: "abcdefghijklmnopqrstuvwxyz",
};

const japaneseSequences = [ALPHABETS.ja, "がぎぐげござじずぜぞだぢづでど", "ばびぶべぼ", "ぱぴぷぺぽ"];
const letters = new Map();
for (const alphabet of [...japaneseSequences, ALPHABETS.en]) {
  [...alphabet].forEach((character, rank) => letters.set(character, { alphabet, rank }));
}

const smallKana = { ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ" };

export function normalize(text, language, input = false) {
  const value = text.normalize("NFKC").trim();
  const chars = input ? value.replace(/\s+/g, "") : value;
  if (language === "en") return chars.toLowerCase();
  const kana = chars.replace(/[ァ-ヶ]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 0x60));
  return input ? kana.replace(/[ぁぃぅぇぉゃゅょゎ]/g, (letter) => smallKana[letter]) : kana;
}

export function fitsAlphabet(word, language) {
  return word.length > 0 && [...word].every((letter) => {
    const alphabet = letters.get(letter)?.alphabet;
    return language === "ja" ? japaneseSequences.includes(alphabet) : alphabet === ALPHABETS.en;
  });
}

export function makeDictionary(entries, language) {
  const lengths = new Map();
  for (const [raw, id] of entries) {
    const word = normalize(raw, language);
    if (!fitsAlphabet(word, language)) continue;
    if (!lengths.has(word.length)) lengths.set(word.length, new Map());
    const words = lengths.get(word.length);
    if (!words.has(word)) words.set(word, { word, dictionaries: [] });
    const entry = words.get(word);
    if (!entry.dictionaries.includes(id)) entry.dictionaries.push(id);
  }
  return lengths;
}

const mod = (n, size) => ((n % size) + size) % size;

function loopPeriod(a, b) {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return a * b / x;
}

function allowedMoves(startA, startB, min, max, loop) {
  const { alphabet: alphabetA, rank: rankA } = letters.get(startA);
  const { alphabet: alphabetB, rank: rankB } = letters.get(startB);
  const moves = new Map();
  const record = (step) => {
    const endA = alphabetA[mod(rankA + step, alphabetA.length)];
    const endB = alphabetB[mod(rankB + step, alphabetB.length)];
    if (!moves.has(endA)) moves.set(endA, new Map());
    moves.get(endA).set(endB, step);
  };

  if (loop) {
    // Each residue modulo the least common multiple produces a distinct pair.
    // Keep the representative closest to zero, preferring negative ties.
    const period = loopPeriod(alphabetA.length, alphabetB.length);
    for (let residue = 0; residue < period; residue++) {
      const first = min + mod(residue - min, period);
      if (first > max) continue;
      const last = max - mod(max - residue, period);
      const negative = residue - period;
      const closest = first >= 0 ? first : last <= 0 ? last : (
        min <= negative && (residue > max || -negative <= residue) ? negative : residue
      );
      record(closest);
    }
  } else {
    const first = Math.max(min, -rankA, -rankB);
    const last = Math.min(max, alphabetA.length - 1 - rankA, alphabetB.length - 1 - rankB);
    for (let step = first; step <= last; step++) record(step || 0);
  }
  return moves;
}

function score(result) {
  return result.shifts.reduce((total, step) => total + Math.abs(step), 0);
}

export function searchPairs(left, right, { min, max, loop }) {
  if (left.text.length !== right.text.length) throw new Error("2つの文字列を同じ長さにしてください。");
  if (![min, max].every(Number.isSafeInteger) || min > max) throw new Error("シフト範囲を正しく入力してください。");
  const length = left.text.length;
  const wordsA = left.dictionary.get(length);
  const wordsB = right.dictionary.get(length);
  if (!wordsA || !wordsB) return [];

  const moves = [...left.text].map((letter, i) => allowedMoves(letter, right.text[i], min, max, loop));
  if (moves.some((options) => options.size === 0)) return [];

  const results = [];
  const compare = (a, b) => {
    if (b.word === right.text) return;
    const shifts = [];
    for (let i = 0; i < length; i++) {
      const step = moves[i].get(a.word[i])?.get(b.word[i]);
      if (step === undefined) return;
      shifts.push(step);
    }
    results.push({ left: a, right: b, shifts });
  };

  // Whenever each target letter on the left fixes its counterpart, look up
  // the full word on the right directly.
  const directLookup = moves.every((options) => [...options.values()].every((pair) => pair.size === 1));
  if (directLookup) {
    for (const a of wordsA.values()) {
      if (a.word === left.text) continue;
      let target = "";
      for (let i = 0; i < length; i++) {
        const options = moves[i].get(a.word[i]);
        if (!options) break;
        target += options.keys().next().value;
      }
      const b = wordsB.get(target);
      if (b) compare(a, b);
    }
  } else {
    const candidatesA = [...wordsA.values()].filter((a) =>
      a.word !== left.text && [...a.word].every((letter, i) => moves[i].has(letter))
    );
    const optionsB = moves.map((options) => new Set([...options.values()].flatMap((pair) => [...pair.keys()])));
    const candidatesB = [...wordsB.values()].filter((b) =>
      b.word !== right.text && [...b.word].every((letter, i) => optionsB[i].has(letter))
    );
    for (const a of candidatesA) {
      for (const b of candidatesB) compare(a, b);
    }
  }
  return results.sort((a, b) =>
    score(a) - score(b) || a.left.word.localeCompare(b.left.word, left.language)
      || a.right.word.localeCompare(b.right.word, right.language)
  );
}

export function detectInput(raw) {
  const kana = normalize(raw, "ja", true);
  if (fitsAlphabet(kana, "ja")) return { language: "ja", text: kana };
  const latin = normalize(raw, "en", true);
  if (fitsAlphabet(latin, "en")) return { language: "en", text: latin };
  return { language: null, text: kana };
}
