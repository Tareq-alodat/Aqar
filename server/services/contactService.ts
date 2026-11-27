import type { Knex } from "knex";

/**
 * Proxy contact number for a listing (SPEC §8). Public by design; the owner's
 * real phone is never used here. Resolution order, active numbers only:
 * 1. the listing's own number (`scope = 'property'`)
 * 2. the listing's area, then each ancestor (area → city → governorate)
 * 3. the country's number
 * 4. the global default
 */

export interface ContactNumber {
  /** E.164, e.g. +96265000001 */
  phone: string;
  whatsapp: boolean;
}

export async function resolveContactNumber(
  db: Knex,
  listing: { id: number; adminAreaId: number | null; countryCode: string },
): Promise<ContactNumber | null> {
  const r = await db.raw<{ rows: Array<{ phone_number: string; whatsapp: boolean }> }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, 0 AS depth FROM admin_areas WHERE id = ?
       UNION ALL
       SELECT a.id, a.parent_id, c.depth + 1 FROM admin_areas a JOIN chain c ON a.id = c.parent_id
     )
     SELECT cn.phone_number, cn.whatsapp
       FROM contact_numbers cn
       LEFT JOIN chain ON cn.scope = 'admin_area' AND cn.admin_area_id = chain.id
      WHERE cn.is_active
        AND (   (cn.scope = 'property' AND cn.property_id = ?)
             OR (cn.scope = 'admin_area' AND chain.id IS NOT NULL)
             OR (cn.scope = 'country' AND cn.country_code = ?)
             OR  cn.scope = 'global')
      ORDER BY CASE cn.scope WHEN 'property' THEN 0 WHEN 'admin_area' THEN 1 WHEN 'country' THEN 2 ELSE 3 END,
               chain.depth NULLS LAST, cn.id
      LIMIT 1`,
    [listing.adminAreaId, listing.id, listing.countryCode],
  );
  const row = r.rows[0];
  return row ? { phone: row.phone_number, whatsapp: row.whatsapp } : null;
}
