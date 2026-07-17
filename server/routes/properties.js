const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all active properties
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM properties WHERE status = 'active' ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST a new property
router.post('/', async (req, res) => {
  const { owner_id, title, description, property_type, listed_price, area_sqm, city, district } = req.body;

  if (!owner_id || !title || !property_type || !listed_price) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO properties (owner_id, title, description, property_type, listed_price, area_sqm, city, district)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [owner_id, title, description, property_type, listed_price, area_sqm, city, district]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// PATCH: approve a pending property
router.patch('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approved_by } = req.body;

  try {
    const result = await pool.query(
      `UPDATE properties
       SET status = 'active', approved_at = now(), approved_by = $1
       WHERE id = $2 AND status = 'pending_review'
       RETURNING *`,
      [approved_by, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found or not pending review' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: all pending properties (for admin review queue)
router.get('/pending/all', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM properties WHERE status = 'pending_review' ORDER BY created_at ASC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;