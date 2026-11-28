import source from "../../../docs/legal/commission-terms.md?raw";
import { parseBilingualDocument } from "./markdown";

/**
 * The listing & commission terms (SPEC §19), rendered from the reviewed file
 * `docs/legal/commission-terms.md` — the single source of the text. The
 * Arabic text prevails; the English is a translation. A test checks that the
 * file's version matches `COMMISSION_TERMS_VERSION`.
 */
export const commissionTermsDocument = parseBilingualDocument(source);
