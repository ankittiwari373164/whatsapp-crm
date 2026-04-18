const express = require('express');
const cors = require('cors');
const { Database } = require('node-sqlite3-wasm');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'whatsapp.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    total INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    delivered INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    contact_phone TEXT NOT NULL,
    direction TEXT NOT NULL,
    content TEXT,
    image_url TEXT,
    wa_message_id TEXT,
    status TEXT DEFAULT 'sent',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
  );

  CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_phone TEXT NOT NULL,
    content TEXT,
    wa_message_id TEXT,
    is_read INTEGER DEFAULT 0,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

async function sendWhatsAppMessage(phone, message, imageUrl) {
  const phoneNumberId = getSetting('phone_number_id');
  const accessToken = getSetting('access_token');
  const apiVersion = getSetting('api_version') || 'v20.0';

  if (!phoneNumberId || !accessToken) throw new Error('API credentials not configured');

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  let body;
  if (imageUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: { link: imageUrl, caption: message }
    };
  } else {
    body = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message }
    };
  }

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data;
}

// ─── Settings API ─────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const keys = ['phone_number_id', 'access_token', 'api_version', 'cost_per_msg', 'delay_ms', 'webhook_verify_token'];
  const result = {};
  for (const k of keys) result[k] = getSetting(k) || '';
  res.json(result);
});

app.post('/api/settings', (req, res) => {
  const allowed = ['phone_number_id', 'access_token', 'api_version', 'cost_per_msg', 'delay_ms', 'webhook_verify_token'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) setSetting(key, req.body[key]);
  }
  res.json({ success: true });
});

// ─── Dashboard Stats API ──────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const totalSent     = db.get("SELECT COALESCE(SUM(sent),0) as v FROM campaigns").v;
  const totalFailed   = db.get("SELECT COALESCE(SUM(failed),0) as v FROM campaigns").v;
  const totalReplies  = db.get("SELECT COUNT(*) as v FROM replies").v;
  const unreadReplies = db.get("SELECT COUNT(*) as v FROM replies WHERE is_read=0").v;
  const totalCost     = db.get("SELECT COALESCE(SUM(cost),0) as v FROM campaigns").v;
  const totalCampaigns= db.get("SELECT COUNT(*) as v FROM campaigns").v;

  const hourly = db.all(`
    SELECT strftime('%H', timestamp) as hour, COUNT(*) as count
    FROM messages WHERE direction='out' AND date(timestamp)=date('now')
    GROUP BY hour ORDER BY hour
  `);

  res.json({ totalSent, totalFailed, totalReplies, unreadReplies, totalCost: totalCost.toFixed(2), totalCampaigns, hourly });
});

// ─── Campaigns API ────────────────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  const campaigns = db.all('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50');
  res.json(campaigns);
});

app.post('/api/campaigns', (req, res) => {
  const { name, message, image_url, phones } = req.body;
  if (!name || !message || !phones || !phones.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const costPerMsg = parseFloat(getSetting('cost_per_msg') || '0.11');
  const result = db.run(
    'INSERT INTO campaigns (name, message, image_url, total, status) VALUES (?, ?, ?, ?, ?)',
    [name, message, image_url || null, phones.length, 'running']
  );

  const campaignId = result.lastInsertRowid;
  res.json({ campaignId, status: 'started' });

  runCampaign(campaignId, phones, message, image_url, costPerMsg);
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db.get('SELECT * FROM campaigns WHERE id=?', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  const msgs = db.all('SELECT * FROM messages WHERE campaign_id=? ORDER BY timestamp', [req.params.id]);
  res.json({ ...campaign, messages: msgs });
});

app.post('/api/campaigns/:id/stop', (req, res) => {
  db.run("UPDATE campaigns SET status='stopped' WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

// ─── Campaign Runner ──────────────────────────────────────────────────────────
async function runCampaign(campaignId, phones, message, imageUrl, costPerMsg) {
  const delayMs = parseInt(getSetting('delay_ms') || '100');
  let sent = 0, failed = 0;

  for (const phone of phones) {
    const campaign = db.get('SELECT status FROM campaigns WHERE id=?', [campaignId]);
    if (!campaign || campaign.status === 'stopped') break;

    const cleanPhone = phone.toString().replace(/\D/g, '');
    try {
      const result = await sendWhatsAppMessage(cleanPhone, message, imageUrl);
      const waId = result?.messages?.[0]?.id || null;

      db.run(
        'INSERT INTO messages (campaign_id, contact_phone, direction, content, image_url, wa_message_id, status) VALUES (?,?,?,?,?,?,?)',
        [campaignId, cleanPhone, 'out', message, imageUrl || null, waId, 'sent']
      );

      db.run('INSERT OR IGNORE INTO contacts (phone) VALUES (?)', [cleanPhone]);
      sent++;
    } catch (err) {
      db.run(
        'INSERT INTO messages (campaign_id, contact_phone, direction, content, status) VALUES (?,?,?,?,?)',
        [campaignId, cleanPhone, 'out', message, 'failed']
      );
      failed++;
    }

    const cost = sent * costPerMsg;
    db.run('UPDATE campaigns SET sent=?, failed=?, cost=? WHERE id=?', [sent, failed, cost, campaignId]);

    await new Promise(r => setTimeout(r, delayMs));
  }

  db.run("UPDATE campaigns SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=?", [campaignId]);
}

// ─── Inbox / Replies API ──────────────────────────────────────────────────────
app.get('/api/inbox', (req, res) => {
  const convos = db.all(`
    SELECT c.phone, c.name,
      (SELECT content FROM messages m WHERE m.contact_phone=c.phone ORDER BY m.timestamp DESC LIMIT 1) as last_msg,
      (SELECT timestamp FROM messages m WHERE m.contact_phone=c.phone ORDER BY m.timestamp DESC LIMIT 1) as last_time,
      (SELECT COUNT(*) FROM replies r WHERE r.contact_phone=c.phone AND r.is_read=0) as unread
    FROM contacts c ORDER BY last_time DESC
  `);
  res.json(convos);
});

app.get('/api/inbox/:phone', (req, res) => {
  const phone = req.params.phone;
  db.run('UPDATE replies SET is_read=1 WHERE contact_phone=?', [phone]);

  const outbound = db.all('SELECT *, "out" as dir FROM messages WHERE contact_phone=? ORDER BY timestamp', [phone]);
  const inbound  = db.all('SELECT *, content, "in" as dir, received_at as timestamp FROM replies WHERE contact_phone=? ORDER BY received_at', [phone]);

  const merged = [...outbound, ...inbound].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json(merged);
});

app.post('/api/inbox/:phone/reply', async (req, res) => {
  const { message, imageUrl } = req.body;
  const phone = req.params.phone;

  try {
    const result = await sendWhatsAppMessage(phone, message, imageUrl);
    const waId = result?.messages?.[0]?.id || null;

    db.run(
      'INSERT INTO messages (contact_phone, direction, content, image_url, wa_message_id, status) VALUES (?,?,?,?,?,?)',
      [phone, 'out', message, imageUrl || null, waId, 'sent']
    );

    db.run('INSERT OR IGNORE INTO contacts (phone) VALUES (?)', [phone]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Contacts API ─────────────────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => {
  const contacts = db.all('SELECT * FROM contacts ORDER BY created_at DESC');
  res.json(contacts);
});

app.post('/api/contacts/import', (req, res) => {
  const { phones } = req.body;
  let imported = 0;
  for (const phone of phones) {
    const clean = phone.toString().replace(/\D/g, '');
    if (clean.length >= 7) {
      db.run('INSERT OR IGNORE INTO contacts (phone) VALUES (?)', [clean]);
      imported++;
    }
  }
  res.json({ imported });
});

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = getSetting('webhook_verify_token') || 'myverifytoken123';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        for (const msg of value.messages || []) {
          const from = msg.from;
          let content = '';

          if (msg.type === 'text')       content = msg.text?.body || '';
          else if (msg.type === 'image') content = '[Image received]';
          else if (msg.type === 'audio') content = '[Audio received]';
          else if (msg.type === 'video') content = '[Video received]';
          else                           content = `[${msg.type} received]`;

          db.run(
            'INSERT INTO replies (contact_phone, content, wa_message_id) VALUES (?,?,?)',
            [from, content, msg.id]
          );

          const profileName = value.contacts?.find(c => c.wa_id === from)?.profile?.name;
          if (profileName) {
            db.run('INSERT OR IGNORE INTO contacts (phone, name) VALUES (?,?)', [from, profileName]);
            db.run('UPDATE contacts SET name=? WHERE phone=? AND (name IS NULL OR name="")', [profileName, from]);
          } else {
            db.run('INSERT OR IGNORE INTO contacts (phone) VALUES (?)', [from]);
          }

          console.log(`New reply from ${from}: ${content}`);
        }

        for (const status of value.statuses || []) {
          if (status.status === 'delivered') {
            db.run("UPDATE messages SET status='delivered' WHERE wa_message_id=?", [status.id]);
            db.run(
              "UPDATE campaigns SET delivered=delivered+1 WHERE id=(SELECT campaign_id FROM messages WHERE wa_message_id=?)",
              [status.id]
            );
          } else if (status.status === 'read') {
            db.run("UPDATE messages SET status='read' WHERE wa_message_id=?", [status.id]);
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── Export ───────────────────────────────────────────────────────────────────
app.get('/api/export/sent', (req, res) => {
  const msgs = db.all(`
    SELECT m.contact_phone, m.status, m.timestamp, c.name as campaign
    FROM messages m LEFT JOIN campaigns c ON m.campaign_id=c.id
    WHERE m.direction='out' ORDER BY m.timestamp DESC
  `);

  let csv = 'Phone,Status,Campaign,Time\n';
  for (const m of msgs) csv += `${m.contact_phone},${m.status},${m.campaign||''},${m.timestamp}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sent_log.csv');
  res.send(csv);
});

app.get('/api/export/replies', (req, res) => {
  const replies = db.all('SELECT contact_phone, content, received_at FROM replies ORDER BY received_at DESC');

  let csv = 'Phone,Message,Time\n';
  for (const r of replies) csv += `${r.contact_phone},"${(r.content||'').replace(/"/g,'""')}",${r.received_at}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=replies.csv');
  res.send(csv);
});

// ─── Catch-all → Frontend ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ WhatsApp CRM running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Webhook endpoint: http://0.0.0.0:${PORT}/webhook`);
  console.log(`🗄️  Database: whatsapp.db\n`);
});