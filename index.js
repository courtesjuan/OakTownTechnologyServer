const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;
const pool = require('./db');

app.use(cors());
app.use(express.json());

// ----------------------
// Client Endpoints
// ----------------------

// Get Clients from MySQL
app.get('/api/clients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create Client using MySQL
app.post('/api/clients', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country } = req.body;
    const [result] = await pool.query(
      `INSERT INTO clients 
       (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country]
    );
    res.json({ message: 'Client created', id: result.insertId });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update Client using MySQL
app.put('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country } = req.body;
    const [result] = await pool.query(
      `UPDATE clients 
       SET first_name = ?, last_name = ?, email = ?, phone = ?, address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip = ?, country = ?
       WHERE id = ?`,
      [first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json({ message: 'Client updated', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Client using MySQL
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM clients WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json({ message: 'Client deleted', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a single client by ID
app.get('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------
// Invoice Endpoints (New Schema)
// ----------------------

// GET: Fetch Invoices Summary (Header Only)
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
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Fetch a Single Invoice by ID (Header + Line Items)
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const queryHeader = `
      SELECT 
        i.id, 
        i.client_id, 
        i.invoice_number, 
        i.invoice_date, 
        i.status,
        i.total_due,
        CONCAT(c.first_name, ' ', c.last_name) AS client_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.id = ?
    `;
    const [headerRows] = await pool.query(queryHeader, [id]);
    if (headerRows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const invoiceHeader = headerRows[0];

    const [lineItems] = await pool.query(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ?',
      [id]
    );
    invoiceHeader.line_items = lineItems;
    res.json(invoiceHeader);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Create Invoice (Header + Line Items) with Transaction
app.post('/api/invoices', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { client_id, invoice_date, status, line_items } = req.body;
    const dayjs = require('dayjs');
    const formattedInvoiceDate = invoice_date ? dayjs(invoice_date).format('YYYY-MM-DD') : null;
    
    // Calculate total due from line_items
    let total_due = 0;
    if (line_items && Array.isArray(line_items)) {
      total_due = line_items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0));
        return sum + itemAmount;
      }, 0);
    }
    
    await connection.beginTransaction();

    // Insert invoice header; invoice_number is empty for now
    const [result] = await connection.query(
      `INSERT INTO invoices (client_id, invoice_number, invoice_date, status, total_due)
       VALUES (?, '', ?, ?, ?)`,
      [client_id, formattedInvoiceDate, status || 'pending', total_due]
    );
    const invoiceId = result.insertId;
    const generatedInvoiceNumber = `OTT-${invoiceId + 99}`;
    
    await connection.query(
      `UPDATE invoices SET invoice_number = ? WHERE id = ?`,
      [generatedInvoiceNumber, invoiceId]
    );
    
    if (line_items && Array.isArray(line_items)) {
      for (const item of line_items) {
        const { item_date, activity, description, quantity, rate, amount } = item;
        const formattedItemDate = item_date ? dayjs(item_date).format('YYYY-MM-DD') : null;
        const calculatedAmount = parseFloat(amount) || ((parseFloat(quantity) || 0) * (parseFloat(rate) || 0));
        await connection.query(
          `INSERT INTO invoice_line_items (invoice_id, item_date, activity, description, quantity, rate, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [invoiceId, formattedItemDate, activity, description, quantity, rate, calculatedAmount]
        );
      }
    }
    
    await connection.commit();
    res.json({
      message: 'Invoice created',
      id: invoiceId,
      invoice_number: generatedInvoiceNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// PUT: Update an Invoice (Header + Line Items) with Total Update and Transaction
app.put('/api/invoices/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { client_id, invoice_date, status, line_items } = req.body;
    const dayjs = require('dayjs');
    
    // Recalculate total_due from the provided line items
    let total_due = 0;
    if (line_items && Array.isArray(line_items)) {
      total_due = line_items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0));
        return sum + itemAmount;
      }, 0);
    }
    
    await connection.beginTransaction();

    // Update invoice header with recalculated total_due (do not update invoice_number)
    const [headerResult] = await connection.query(
      `UPDATE invoices 
       SET client_id = ?, invoice_date = ?, status = ?, total_due = ?
       WHERE id = ?`,
      [client_id, invoice_date, status || 'pending', total_due, id]
    );
    if (headerResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Delete existing line items for this invoice
    await connection.query('DELETE FROM invoice_line_items WHERE invoice_id = ?', [id]);
    
    // Insert new/updated line items
    if (line_items && Array.isArray(line_items)) {
      for (const item of line_items) {
        const { item_date, activity, description, quantity, rate, amount } = item;
        const formattedItemDate = item_date ? dayjs(item_date).format('YYYY-MM-DD') : null;
        const calculatedAmount = parseFloat(amount) || ((parseFloat(quantity) || 0) * (parseFloat(rate) || 0));
        await connection.query(
          `INSERT INTO invoice_line_items (invoice_id, item_date, activity, description, quantity, rate, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, formattedItemDate, activity, description, quantity, rate, calculatedAmount]
        );
      }
    }
    
    await connection.commit();
    res.json({ message: 'Invoice updated', affectedRows: headerResult.affectedRows });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE: Delete an Invoice (remove line items first)
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM invoice_line_items WHERE invoice_id = ?', [id]);
    const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
