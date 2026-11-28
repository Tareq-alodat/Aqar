import type { Block, Inline } from "~/shared/legal/markdown";

/** Latin/number tokens with separators (e.g. "2026-12-v1"), which the bidi algorithm would reorder inside Arabic text. */
const LTR_TOKEN = /([0-9A-Za-z]+(?:[-/.][0-9A-Za-z]+)+)/;

/** Text with such tokens isolated as LTR (only needed in right-to-left text). */
function Text({ text, rtl }: { text: string; rtl: boolean }) {
  if (!rtl) return <>{text}</>;
  return (
    <>
      {text.split(LTR_TOKEN).map((part, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr">
            {part}
          </bdi>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Spans({ spans, rtl }: { spans: Inline[]; rtl: boolean }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === "bold" ? (
          <strong key={i} className="font-semibold">
            <Text text={s.text} rtl={rtl} />
          </strong>
        ) : s.kind === "italic" ? (
          <em key={i}>
            <Text text={s.text} rtl={rtl} />
          </em>
        ) : (
          <span key={i}>
            <Text text={s.text} rtl={rtl} />
          </span>
        ),
      )}
    </>
  );
}

/**
 * A legal document from `docs/legal/` (parsed by `~/shared/legal/markdown`).
 * The file's `#` becomes an `<h2>` and `##` an `<h3>` (the page has its own `<h1>`).
 * Rendered as React elements only, so the text is always escaped.
 */
export function LegalDocument({ blocks, lang }: { blocks: Block[]; lang: "ar" | "en" }) {
  const rtl = lang === "ar";
  return (
    <div lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`flex flex-col gap-3 leading-relaxed ${lang === "ar" ? "font-arabic" : "font-latin"}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return b.level === 1 ? (
              <h2 key={i} className="text-xl font-bold">
                <Spans spans={b.content} rtl={rtl} />
              </h2>
            ) : (
              <h3 key={i} className="mt-2 text-lg font-bold">
                <Spans spans={b.content} rtl={rtl} />
              </h3>
            );
          case "paragraph":
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <span key={j} className="block">
                    <Spans spans={line} rtl={rtl} />
                  </span>
                ))}
              </p>
            );
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={i} className={`flex flex-col gap-1.5 ps-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} rtl={rtl} />
                  </li>
                ))}
              </List>
            );
          }
          case "rule":
            return <hr key={i} className="border-border" />;
        }
      })}
    </div>
  );
}
