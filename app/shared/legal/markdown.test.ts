import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMISSION_TERMS_VERSION, isDraftTermsVersion } from "../terms";
import { commissionTermsDocument } from "./commissionTerms";
import { documentVersion, parseBilingualDocument, parseInline, parseLegalMarkdown, plainText, type Block } from "./markdown";

describe("legal markdown subset", () => {
  it("parses bold, italic and plain spans; never HTML", () => {
    expect(parseInline("a **b** c *d* <script>")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c " },
      { kind: "italic", text: "d" },
      { kind: "text", text: " <script>" },
    ]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
  });

  it("parses headings, multi-line paragraphs, ordered/unordered lists and rules (CRLF too)", () => {
    const blocks = parseLegalMarkdown("# T\r\n**V:** 1  \r\nline two\r\n\r\n## S\r\n- a\r\n- b\r\n1. x\r\n2. y\r\ntext\r\n---\r\n");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "heading", "list", "list", "paragraph", "rule"]);
    expect((blocks[1] as Extract<Block, { kind: "paragraph" }>).lines.map(plainText)).toEqual(["V: 1", "line two"]);
    expect((blocks[3] as Extract<Block, { kind: "list" }>).ordered).toBe(false);
    expect((blocks[4] as Extract<Block, { kind: "list" }>).items.map(plainText)).toEqual(["x", "y"]);
  });

  it("splits a bilingual file at the double rule and refuses other shapes", () => {
    const doc = parseBilingualDocument("# ع\n---\n\n---\n---\n\n# E\n");
    expect(doc.ar.map((b) => b.kind)).toEqual(["heading"]);
    expect(doc.en.map((b) => b.kind)).toEqual(["heading"]);
    expect(() => parseBilingualDocument("# only one language")).toThrow();
  });
});

describe("commission terms document (docs/legal/commission-terms.md)", () => {
  it("is the file in docs/legal and carries the active, non-draft version in both languages", () => {
    const raw = readFileSync("docs/legal/commission-terms.md", "utf8");
    expect(raw).toContain(COMMISSION_TERMS_VERSION);
    expect(isDraftTermsVersion(COMMISSION_TERMS_VERSION)).toBe(false);
    expect(documentVersion(commissionTermsDocument.ar)).toBe(COMMISSION_TERMS_VERSION);
    expect(documentVersion(commissionTermsDocument.en)).toBe(COMMISSION_TERMS_VERSION);
  });

  it("has the ten Arabic sections and the ten English clauses", () => {
    const arSections = commissionTermsDocument.ar.filter((b) => b.kind === "heading" && b.level === 2);
    expect(arSections).toHaveLength(10);
    const enClauses = commissionTermsDocument.en.find((b) => b.kind === "list" && b.ordered) as Extract<Block, { kind: "list" }>;
    expect(enClauses.items).toHaveLength(10);
    const text = JSON.stringify(commissionTermsDocument);
    for (const phrase of ["(١٢) شهراً", "(٧) أيام", "(١٤) يوماً", "لا تُفرض أي فوائد على التأخير", "within 12 months", "within 7 days", "within 14 days", "no late-payment interest"]) {
      expect(text, phrase).toContain(phrase);
    }
  });
});
