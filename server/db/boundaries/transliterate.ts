/**
 * Rough Arabic → Latin transliteration for place names that have no English
 * name in OSM. Output is a readable draft, not a standard romanization: every
 * name produced here is stored with `name_en_reviewed = false` for an admin to
 * correct (SPEC §2.2).
 */

/** Whole words with an established spelling. Keys are already letter-folded (see fold()). */
const WORDS: Record<string, string> = {
  جبل: "Jabal",
  حي: "Hay",
  ام: "Umm",
  ابو: "Abu",
  ابي: "Abi",
  بني: "Bani",
  عين: "Ain",
  وادي: "Wadi",
  ضاحيه: "Dahiet",
  مرج: "Marj",
  مخيم: "Camp",
  دوار: "Dawar",
  تلاع: "Tla'",
  شارع: "Street",
  عمان: "Amman",
  عبدون: "Abdoun",
  خلدا: "Khalda",
  الصويفيه: "Al-Sweifieh",
  الجبيهه: "Al-Jubeiha",
  دابوق: "Dabouq",
  الشمالي: "Al-Shamali",
  الشماليه: "Al-Shamaliya",
  الجنوبي: "Al-Janoubi",
  الجنوبيه: "Al-Janoubiya",
  الشرقي: "Al-Sharqi",
  الشرقيه: "Al-Sharqiya",
  الغربي: "Al-Gharbi",
  الغربيه: "Al-Gharbiya",
  القديمه: "Al-Qadima",
  الجديده: "Al-Jadida",
  العلي: "Al-Ali",
};

const LETTERS: Record<string, string> = {
  ا: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "'",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  ء: "'",
  ئ: "'",
  ؤ: "'",
};

const ALEF_VARIANTS = /[أإآٱ]/g; // أ إ آ ٱ
const DIACRITICS = /[ً-ٰٟـ]/g; // harakat, superscript alef, tatweel

/** Folds spelling variants so dictionary lookups match: alef forms, taa marbuta, alef maqsura, diacritics. */
export function fold(word: string): string {
  return word.replace(DIACRITICS, "").replace(ALEF_VARIANTS, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

const isLetter = (c: string | undefined) => c !== undefined && /[ء-ي]/.test(c);
const isLongVowel = (c: string | undefined) => c === "ا" || c === "و" || c === "ي";

function transliterateWord(raw: string, original: string): string {
  const word = fold(raw);
  const known = WORDS[word];
  if (known) return known;

  if (word.startsWith("ال") && word.length > 2) {
    return `Al-${capitalize(transliterateWord(word.slice(2), original.slice(2)))}`;
  }

  let out = "";
  const chars = [...word];
  chars.forEach((c, i) => {
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const last = i === chars.length - 1;
    if (c === "و") out += i === 0 || isLongVowel(next) || prev === "ا" ? "w" : "ou";
    else if (c === "ي") out += i === 0 || isLongVowel(next) || prev === "ا" ? "y" : last ? "i" : "ei";
    // Original taa marbuta (folded to ه) at the end is pronounced "a".
    else if (c === "ه" && last && [...original].at(-1) === "ة") out += "a";
    else if (c === "ا" && i === 0) out += "a";
    else if (c === "ع" && i === 0) out += isLongVowel(next) ? "" : "a";
    else if (c === "ع" && last) out += "";
    else out += LETTERS[c] ?? (isLetter(c) ? "" : c);
  });
  return capitalize(out.replace(/''+/g, "'"));
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function transliterate(arabic: string): string {
  return arabic
    .trim()
    .split(/\s+/)
    .map((w) => transliterateWord(w.replace(DIACRITICS, ""), w))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL slug from an English name: lowercase ASCII words joined by "-". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
