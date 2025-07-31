// index.js
const path = require('path');

// Debug: show working directory and .env path
console.log('🗂  cwd:', process.cwd());
console.log('📄  .env path:', path.resolve(__dirname, '.env'));

// Load environment variables explicitly from project root .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors    = require('cors');
const pool    = require('./db');      // ← pg Pool configured in db.js

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
      'SELECT * FROM public.clients WHERE id = $1;', [id]
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
      'DELETE FROM public.clients WHERE id = $1;', [id]
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

// GET all invoices (with client name)
app.get('/api/invoices', async (req, res) => {
  try {
    const query = `
      SELECT
        i.id,
        i.client_id,
        i.invoice_number,
        i.invoice_date,
        i.status,
        i.total_due,
        CONCAT(c.first_name, ' ', c.last_name) AS client_name
      FROM public.invoices i
      LEFT JOIN public.clients c ON i.client_id = c.id;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET one invoice + its line items
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const headerRes = await pool.query(
      `SELECT
         i.id,
         i.client_id,
         i.invoice_number,
         i.invoice_date,
         i.status,
         i.total_due,
         CONCAT(c.first_name, ' ', c.last_name) AS client_name
       FROM public.invoices i
       LEFT JOIN public.clients c ON i.client_id = c.id
       WHERE i.id = $1;`,
      [id]
    );
    if (headerRes.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const invoice = headerRes.rows[0];

    const itemsRes = await pool.query(
      'SELECT * FROM public.invoice_line_items WHERE invoice_id = $1;', [id]
    );
    invoice.line_items = itemsRes.rows;

    res.json(invoice);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST new invoice (header + items) in a transaction
app.post('/api/invoices', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { client_id, invoice_date, status, line_items } = req.body;
    const dayjs = require('dayjs');
    const formattedDate = invoice_date
      ? dayjs(invoice_date).format('YYYY-MM-DD')
      : null;

    // calculate total_due
    let total_due = 0;
    if (Array.isArray(line_items)) {
      total_due = line_items.reduce((sum, it) => {
        const amt = parseFloat(it.amount)
          || (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0);
        return sum + amt;
      }, 0);
    }

    // insert header
    const headerRes = await client.query(
      `INSERT INTO public.invoices
         (client_id, invoice_number, invoice_date, status, total_due)
       VALUES ($1, '', $2, $3, $4)
       RETURNING id;`,
      [client_id, formattedDate, status || 'pending', total_due]
    );
    const invoiceId = headerRes.rows[0].id;
    const genNumber = `OTT-${invoiceId + 99}`;

    await client.query(
      'UPDATE public.invoices SET invoice_number = $1 WHERE id = $2;', [genNumber, invoiceId]
    );

    // insert items
    if (Array.isArray(line_items)) {
      for (const it of line_items) {
        const itemDate = it.item_date
          ? dayjs(it.item_date).format('YYYY-MM-DD')
          : null;
        const amt = parseFloat(it.amount)
          || (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0);
        await client.query(
          `INSERT INTO public.invoice_line_items
             (invoice_id, item_date, activity, description, quantity, rate, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [invoiceId, itemDate, it.activity, it.description,
           it.quantity, it.rate, amt]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Invoice created', id: invoiceId, invoice_number: genNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT update an invoice + its items
app.put('/api/invoices/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { client_id, invoice_date, status, line_items } = req.body;
    const dayjs = require('dayjs');
    const formattedDate = invoice_date
      ? dayjs(invoice_date).format('YYYY-MM-DD')
      : null;

    // recalc total_due
    let total_due = 0;
    if (Array.isArray(line_items)) {
      total_due = line_items.reduce((sum, it) => {
        const amt = parseFloat(it.amount)
          || (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0);
        return sum + amt;
      }, 0);
    }

    // update header
    const hdrRes = await client.query(
      `UPDATE public.invoices
         SET client_id = $1,
             invoice_date = $2,
             status = $3,
             total_due = $4
       WHERE id = $5;`,
      [client_id, formattedDate, status || 'pending', total_due, id]
    );
    if (hdrRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // delete old items
    await client.query('DELETE FROM public.invoice_line_items WHERE invoice_id = $1;', [id]);

    // insert new items
    if (Array.isArray(line_items)) {
      for (const it of line_items) {
        const itemDate = it.item_date
          ? dayjs(it.item_date).format('YYYY-MM-DD')
          : null;
        const amt = parseFloat(it.amount)
          || (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0);
        await client.query(
          `INSERT INTO public.invoice_line_items
             (invoice_id, item_date, activity, description, quantity, rate, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [id, itemDate, it.activity, it.description,
           it.quantity, it.rate, amt]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Invoice updated', affectedRows: hdrRes.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating invoice:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE invoice + its items
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM public.invoice_line_items WHERE invoice_id = $1;', [id]);
    const result = await pool.query('DELETE FROM public.invoices WHERE id = $1;', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted', affectedRows: result.rowCount });
  } catch (err) {
    console.error('Error deleting invoice:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
