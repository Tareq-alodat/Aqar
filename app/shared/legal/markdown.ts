/**
 * A deliberately small Markdown reader for the legal documents in
 * `docs/legal/` (the reviewed source text, rendered as is). It supports only
 * what those files use: `#`/`##` headings, paragraphs (consecutive lines,
 * each kept as a line), `-` and `1.` lists, `---` rules, `**bold**` and
 * `*italic*`. No HTML is produced or passed through: the page renders the
 * blocks as React elements, so the text is always escaped.
 */

export type Inline = { kind: "text" | "bold" | "italic"; text: string };

export type Block =
  | { kind: "heading"; level: 1 | 2; content: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "rule" };

/** `**bold**` and `*italic*` spans; anything else is plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "italic", text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const ORDERED = /^\d+\.\s+/;
const UNORDERED = /^[-*]\s+/;

export function parseLegalMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<Block, { kind: "list" }> | null = null;
  const flush = () => {
    if (paragraph) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list) blocks.push(list);
    paragraph = null;
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2, content: parseInline(heading[2]!) });
      continue;
    }
    const ordered = ORDERED.test(line);
    if (ordered || UNORDERED.test(line)) {
      if (paragraph || (list && list.ordered !== ordered)) flush();
      list ??= { kind: "list", ordered, items: [] };
      list.items.push(parseInline(line.replace(ordered ? ORDERED : UNORDERED, "")));
      continue;
    }
    if (list) flush();
    (paragraph ??= []).push(parseInline(line));
  }
  flush();
  return blocks;
}

/** Plain text of inline spans (for comparisons and titles). */
export const plainText = (spans: Inline[]) => spans.map((s) => s.text).join("");

/**
 * A bilingual legal file: the Arabic text (authoritative), then a line `---`
 * twice, then the English translation. Rules at the edges are dropped.
 */
export function parseBilingualDocument(source: string): { ar: Block[]; en: Block[] } {
  const normalized = source.replace(/\r\n?/g, "\n");
  const parts = normalized.split(/\n-{3,}\n-{3,}\n/);
  if (parts.length !== 2) throw new Error("Expected the Arabic text, a double rule, then the English text");
  const trim = (blocks: Block[]) => {
    while (blocks[0]?.kind === "rule") blocks.shift();
    while (blocks.at(-1)?.kind === "rule") blocks.pop();
    return blocks;
  };
  return { ar: trim(parseLegalMarkdown(parts[0]!)), en: trim(parseLegalMarkdown(parts[1]!)) };
}

/** The version written in the document's header (`**الإصدار:** 2026-12-v1` / `**Version:** 2026-12-v1`). */
export function documentVersion(blocks: Block[]): string | null {
  for (const b of blocks) {
    const lines = b.kind === "paragraph" ? b.lines : [];
    for (const line of lines) {
      const m = /(?:الإصدار|Version):\s*([0-9A-Za-z.-]+)/.exec(plainText(line));
      if (m) return m[1]!;
    }
  }
  return null;
}
