// index.js
require('dotenv').config();
console.log('→ Loaded DATABASE_URL:', process.env.DATABASE_URL);
const express = require('express');
const cors    = require('cors');
const pool    = require('./db');      // ← your pg pool in db.js

const app     = express();
const PORT    = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// -------- CLIENTS --------

// GET all clients
app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.clients;');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET one client
app.get('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM public.clients WHERE id = $1;',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE client
app.post('/api/clients', async (req, res) => {
  try {
    const {
      first_name, last_name, email, phone,
      address_line1, address_line2, city, state, zip, country
    } = req.body;

    const result = await pool.query(
      `INSERT INTO public.clients
         (first_name, last_name, email, phone,
          address_line1, address_line2, city, state, zip, country)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id;`,
      [first_name, last_name, email, phone,
       address_line1, address_line2, city, state, zip, country]
    );

    res.json({ message: 'Client created', id: result.rows[0].id });
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE client
app.put('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name, last_name, email, phone,
      address_line1, address_line2, city, state, zip, country
    } = req.body;

    const result = await pool.query(
      `UPDATE public.clients
         SET first_name    = $1,
             last_name     = $2,
             email         = $3,
             phone         = $4,
             address_line1 = $5,
             address_line2 = $6,
             city          = $7,
             state         = $8,
             zip           = $9,
             country       = $10
       WHERE id = $11;`,
      [first_name, last_name, email, phone,
       address_line1, address_line2, city, state, zip, country, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json({ message: 'Client updated', affectedRows: result.rowCount });
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE client
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM public.clients WHERE id = $1;',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json({ message: 'Client deleted', affectedRows: result.rowCount });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------- INVOICES --------
// (You’d update these the same way—use pool.query & result.rows / result.rowCount,
// and switch your ? placeholders to $1, $2, …)

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
