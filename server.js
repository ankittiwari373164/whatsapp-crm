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

// Frontend HTML inlined for Railway compatibility
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WhatsApp CRM</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
:root {
  --green: #25D366;
  --green-dark: #128C7E;
  --green-light: #dcfce7;
  --green-text: #14532d;
  --bg: #0a0f0d;
  --surface: #111714;
  --surface2: #182118;
  --surface3: #1e2b1f;
  --border: rgba(37,211,102,0.12);
  --border2: rgba(37,211,102,0.22);
  --text: #e8f5e9;
  --text2: #86a98a;
  --text3: #4a6b4e;
  --red: #ff4d4d;
  --red-bg: rgba(255,77,77,0.1);
  --amber: #f59e0b;
  --amber-bg: rgba(245,158,11,0.1);
  --blue: #60a5fa;
  --blue-bg: rgba(96,165,250,0.1);
  --radius: 10px;
  --radius-lg: 14px;
  --font: 'DM Sans', sans-serif;
  --mono: 'JetBrains Mono', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); height: 100vh; display: flex; overflow: hidden; font-size: 14px; }

/* Sidebar */
.sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  padding: 0;
}
.logo {
  padding: 20px 18px 16px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.logo-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--green); display: flex; align-items: center; justify-content: center;
}
.logo-icon svg { width: 18px; height: 18px; fill: #fff; }
.logo-text { font-size: 15px; font-weight: 600; color: var(--text); }
.logo-sub { font-size: 10px; color: var(--text3); margin-top: 1px; }

.nav { padding: 10px 8px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer;
  font-size: 13px; color: var(--text2); margin-bottom: 2px;
  transition: all 0.15s; border: none; background: none; width: 100%; text-align: left;
}
.nav-item:hover { background: var(--surface2); color: var(--text); }
.nav-item.active { background: rgba(37,211,102,0.1); color: var(--green); font-weight: 500; }
.nav-item svg { width: 15px; height: 15px; flex-shrink: 0; }
.nav-badge {
  margin-left: auto; background: var(--green); color: #000;
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px;
}

.sidebar-footer {
  padding: 12px 10px;
  border-top: 1px solid var(--border);
}
.status-dot {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text3); padding: 6px 8px;
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.dot.off { background: var(--text3); }

/* Main area */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar {
  height: 56px; flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 24px;
  gap: 12px;
}
.topbar-title { font-size: 15px; font-weight: 600; flex: 1; }
.topbar-sub { font-size: 12px; color: var(--text3); }

.content { flex: 1; overflow-y: auto; padding: 24px; }

/* Panels */
.panel { display: none; }
.panel.active { display: block; }

/* Stats grid */
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 16px 18px;
}
.stat-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.stat-value { font-size: 28px; font-weight: 600; line-height: 1; }
.stat-sub { font-size: 11px; color: var(--text3); margin-top: 6px; }
.stat-green { color: var(--green); }
.stat-red { color: var(--red); }
.stat-amber { color: var(--amber); }
.stat-blue { color: var(--blue); }

/* Cards */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 18px 20px; margin-bottom: 16px;
}
.card-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }

/* Form elements */
label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.04em; display: block; margin-bottom: 6px; margin-top: 12px; }
label:first-child { margin-top: 0; }
input, textarea, select {
  width: 100%; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 12px; color: var(--text); font-family: var(--font); font-size: 13px;
  outline: none; transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus { border-color: var(--green); }
textarea { resize: vertical; min-height: 90px; }
select option { background: var(--surface2); }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; border-radius: var(--radius);
  font-family: var(--font); font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid var(--border2); transition: all 0.15s;
  background: transparent; color: var(--text);
}
.btn:hover { background: var(--surface2); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-green { background: var(--green); color: #000; border-color: var(--green); font-weight: 600; }
.btn-green:hover { background: #20c45e; }
.btn-red { background: var(--red-bg); color: var(--red); border-color: rgba(255,77,77,0.25); }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-full { width: 100%; justify-content: center; }

/* Badge */
.badge {
  display: inline-flex; align-items: center;
  font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 500;
}
.badge-green { background: rgba(37,211,102,0.12); color: var(--green); }
.badge-red { background: var(--red-bg); color: var(--red); }
.badge-amber { background: var(--amber-bg); color: var(--amber); }
.badge-blue { background: var(--blue-bg); color: var(--blue); }
.badge-gray { background: var(--surface3); color: var(--text2); }

/* Row/Grid */
.row { display: flex; gap: 14px; }
.row > * { flex: 1; }
.col-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.col-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }

/* Table */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 12px; border-bottom: 1px solid var(--border); }
td { padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text2); }
td:first-child { color: var(--text); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--surface2); }

/* Progress bar */
.progress-wrap { height: 6px; background: var(--surface3); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width 0.5s; }

/* Inbox layout */
.inbox-layout { display: flex; gap: 0; height: calc(100vh - 56px - 48px); }
.convo-list {
  width: 280px; flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  background: var(--surface);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}
.convo-search { padding: 12px; border-bottom: 1px solid var(--border); }
.convo-search input { background: var(--surface2); }
.convo-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.convo-item:hover { background: var(--surface2); }
.convo-item.active { background: rgba(37,211,102,0.08); }
.avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: var(--surface3); display: flex; align-items: center;
  justify-content: center; font-size: 13px; font-weight: 600;
  color: var(--green); flex-shrink: 0; border: 1px solid var(--border);
}
.convo-info { flex: 1; min-width: 0; }
.convo-name { font-size: 13px; font-weight: 500; color: var(--text); }
.convo-preview { font-size: 12px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.convo-time { font-size: 11px; color: var(--text3); }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); flex-shrink: 0; }

.chat-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; }
.chat-header {
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
}
.chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.bubble-wrap { display: flex; flex-direction: column; max-width: 70%; }
.bubble-wrap.out { align-self: flex-end; align-items: flex-end; }
.bubble-wrap.in { align-self: flex-start; }
.bubble {
  padding: 9px 13px; border-radius: 14px;
  font-size: 13px; line-height: 1.5; word-break: break-word;
}
.bubble.out { background: rgba(37,211,102,0.15); color: var(--text); border-bottom-right-radius: 4px; border: 1px solid rgba(37,211,102,0.2); }
.bubble.in { background: var(--surface2); color: var(--text); border-bottom-left-radius: 4px; border: 1px solid var(--border); }
.bubble-time { font-size: 10px; color: var(--text3); margin-top: 3px; padding: 0 4px; }
.chat-input-area { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; gap: 10px; flex-shrink: 0; }
.chat-input-area input { flex: 1; }

/* Log */
.log-area {
  background: var(--bg); border-radius: var(--radius); padding: 12px;
  font-family: var(--mono); font-size: 12px; max-height: 200px;
  overflow-y: auto; border: 1px solid var(--border);
}
.log-line { padding: 2px 0; }
.log-ok { color: var(--green); }
.log-err { color: var(--red); }
.log-info { color: var(--text3); }

/* Campaign progress card */
.campaign-progress { padding: 14px 0; border-bottom: 1px solid var(--border); }
.campaign-progress:last-child { border-bottom: none; padding-bottom: 0; }

/* Webhook code */
.code-block {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 12px 14px;
  font-family: var(--mono); font-size: 12px; color: #86efac;
  overflow-x: auto; white-space: pre;
}

/* Image preview */
.img-prev {
  width: 54px; height: 54px; border-radius: var(--radius);
  object-fit: cover; border: 1px solid var(--border); flex-shrink: 0;
}
.img-placeholder {
  width: 54px; height: 54px; border-radius: var(--radius);
  background: var(--surface3); border: 1px dashed var(--border2);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: var(--text3); text-align: center; flex-shrink: 0;
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

/* Chart canvas */
canvas { max-width: 100%; }

/* Animations */
@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.panel.active { animation: fadeIn 0.2s ease; }

/* Responsive */
.campaign-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }

/* Phone numbers textarea */
#phoneNumbers { font-family: var(--mono); font-size: 12px; min-height: 120px; }
</style>
</head>
<body>

<!-- Sidebar -->
<aside class="sidebar">
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </div>
    <div>
      <div class="logo-text">WA CRM</div>
      <div class="logo-sub">Bulk Sender & Inbox</div>
    </div>
  </div>

  <nav class="nav">
    <button class="nav-item active" onclick="switchPanel('dashboard')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      Dashboard
    </button>
    <button class="nav-item" onclick="switchPanel('send')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      Send Campaign
    </button>
    <button class="nav-item" onclick="switchPanel('inbox')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Inbox
      <span class="nav-badge" id="navUnread" style="display:none">0</span>
    </button>
    <button class="nav-item" onclick="switchPanel('campaigns')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Campaigns
    </button>
    <button class="nav-item" onclick="switchPanel('contacts')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Contacts
    </button>
    <button class="nav-item" onclick="switchPanel('webhook')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      Webhook
    </button>
    <button class="nav-item" onclick="switchPanel('settings')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Settings
    </button>
  </nav>

  <div class="sidebar-footer">
    <div class="status-dot"><span class="dot" id="apiDot"></span><span id="apiStatus">Not configured</span></div>
  </div>
</aside>

<!-- Main -->
<div class="main">
  <header class="topbar">
    <div style="flex:1">
      <span class="topbar-title" id="topbarTitle">Dashboard</span>
      <span class="topbar-sub" id="topbarSub"> — Today's overview</span>
    </div>
    <button class="btn btn-sm" onclick="exportSent()">Export Sent</button>
    <button class="btn btn-sm" onclick="exportReplies()">Export Replies</button>
  </header>

  <div class="content" id="mainContent">

    <!-- DASHBOARD -->
    <div class="panel active" id="panel-dashboard">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Sent</div>
          <div class="stat-value stat-blue" id="s-sent">—</div>
          <div class="stat-sub">messages delivered</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Replies Received</div>
          <div class="stat-value stat-green" id="s-replies">—</div>
          <div class="stat-sub" id="s-unread-sub">loading...</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed</div>
          <div class="stat-value stat-red" id="s-failed">—</div>
          <div class="stat-sub">could not deliver</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value stat-amber" id="s-cost">—</div>
          <div class="stat-sub" id="s-campaigns-sub">loading...</div>
        </div>
      </div>

      <div class="col-2">
        <div class="card">
          <div class="card-title">Hourly Activity <span class="badge badge-gray">Today</span></div>
          <canvas id="actChart" height="140"></canvas>
        </div>
        <div class="card">
          <div class="card-title">Recent Campaigns</div>
          <div id="recentCampaigns"><div style="color:var(--text3);font-size:13px;">No campaigns yet</div></div>
        </div>
      </div>
    </div>

    <!-- SEND CAMPAIGN -->
    <div class="panel" id="panel-send">
      <div class="col-2" style="align-items:start;">
        <div>
          <div class="card">
            <div class="card-title">Campaign Details</div>
            <label>Campaign Name</label>
            <input type="text" id="campaignName" placeholder="e.g. April Offer Blast" />
            <label>Message Text</label>
            <textarea id="msgText" placeholder="Hello! We have an exciting offer for you..."></textarea>
            <label>Photo URL (optional)</label>
            <div class="row" style="align-items:center; margin-top:6px;">
              <input type="text" id="imageUrl" placeholder="https://yoursite.com/photo.jpg" oninput="previewImg()" />
              <div id="imgPrev"><div class="img-placeholder">No<br>photo</div></div>
            </div>
            <div class="col-2" style="margin-top:0;">
              <div>
                <label>Delay Between Messages (ms)</label>
                <input type="number" id="delayMs" value="100" min="50" />
              </div>
              <div>
                <label>Cost Per Message (₹)</label>
                <input type="number" id="costPerMsg" value="0.11" step="0.01" />
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Phone Numbers <span class="badge badge-gray" id="phoneCountBadge">0 numbers</span></div>
            <textarea id="phoneNumbers" placeholder="919876543210&#10;918765432109&#10;917654321098&#10;&#10;One number per line&#10;Include country code (91 for India)&#10;No +, spaces, or dashes" oninput="countPhones()"></textarea>
            <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
              <span style="font-size:12px; color:var(--text3);">Estimated cost:</span>
              <span style="font-size:13px; font-weight:600; color:var(--amber);" id="estCost">₹0.00</span>
              <span style="font-size:12px; color:var(--text3);" id="estTime">~0 min</span>
            </div>
          </div>

          <div class="row">
            <button class="btn btn-green btn-full" id="btnSend" onclick="startCampaign()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Send Campaign
            </button>
            <button class="btn btn-red btn-full" id="btnStop" onclick="stopCampaign()" disabled>Stop</button>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-title">Live Progress</div>
            <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text3); margin-bottom:6px;">
              <span id="progLabel">Waiting to start...</span>
              <span id="progPct">0%</span>
            </div>
            <div class="progress-wrap" style="margin-bottom:16px;"><div class="progress-fill" id="progressBar" style="width:0%"></div></div>
            <div class="col-3" style="margin-bottom:16px;">
              <div style="text-align:center;">
                <div style="font-size:11px;color:var(--text3);">Sent</div>
                <div style="font-size:20px;font-weight:600;color:var(--green);" id="liveSent">0</div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:11px;color:var(--text3);">Failed</div>
                <div style="font-size:20px;font-weight:600;color:var(--red);" id="liveFailed">0</div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:11px;color:var(--text3);">Cost ₹</div>
                <div style="font-size:20px;font-weight:600;color:var(--amber);" id="liveCost">0.00</div>
              </div>
            </div>
            <div class="log-area" id="sendLog">
              <div class="log-line log-info">[system] Ready to send...</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Preview</div>
            <div style="background:var(--bg); border-radius:var(--radius); padding:12px; min-height:80px;">
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <div class="avatar" style="width:32px;height:32px;font-size:11px;">YOU</div>
                <div>
                  <div id="previewBubble" style="background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.2);border-radius:12px;border-bottom-right-radius:4px;padding:8px 12px;font-size:13px;color:var(--text);max-width:240px;">
                    Your message will appear here...
                  </div>
                  <div style="font-size:10px;color:var(--text3);margin-top:4px;">Just now · ✓✓</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- INBOX -->
    <div class="panel" id="panel-inbox" style="margin:-24px; height:calc(100vh - 56px);">
      <div class="inbox-layout">
        <div class="convo-list">
          <div class="convo-search">
            <input type="text" placeholder="Search conversations..." oninput="filterConvos(this.value)" />
          </div>
          <div id="convoList"><div style="padding:16px;color:var(--text3);font-size:13px;">Loading...</div></div>
        </div>
        <div class="chat-panel">
          <div class="chat-header">
            <div class="avatar" id="chatAvatar">—</div>
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:600;" id="chatName">Select a conversation</div>
              <div style="font-size:12px;color:var(--text3);" id="chatPhone"></div>
            </div>
            <span class="badge badge-green" id="chatStatus" style="display:none">Active</span>
          </div>
          <div class="chat-messages" id="chatMessages">
            <div style="margin:auto;color:var(--text3);font-size:13px;">Select a conversation from the left</div>
          </div>
          <div class="chat-input-area">
            <input type="text" id="replyInput" placeholder="Type a reply and press Enter..." onkeydown="if(event.key==='Enter')sendReply()" disabled />
            <button class="btn btn-green" id="btnReply" onclick="sendReply()" disabled>Send</button>
          </div>
        </div>
      </div>
    </div>

    <!-- CAMPAIGNS -->
    <div class="panel" id="panel-campaigns">
      <div class="card">
        <div class="card-title">All Campaigns <button class="btn btn-sm" onclick="loadCampaigns()">Refresh</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Campaign</th><th>Sent</th><th>Delivered</th><th>Replies</th><th>Failed</th><th>Cost</th><th>Status</th><th>Date</th>
            </tr></thead>
            <tbody id="campaignTableBody"><tr><td colspan="8" style="color:var(--text3);">No campaigns yet</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- CONTACTS -->
    <div class="panel" id="panel-contacts">
      <div class="col-2" style="align-items:start;">
        <div class="card">
          <div class="card-title">Import Contacts</div>
          <label>Paste Phone Numbers</label>
          <textarea id="importPhones" placeholder="919876543210&#10;918765432109&#10;..." style="min-height:120px; font-family:var(--mono); font-size:12px;"></textarea>
          <button class="btn btn-green btn-full" style="margin-top:10px;" onclick="importContacts()">Import Contacts</button>
        </div>
        <div class="card">
          <div class="card-title">All Contacts <span class="badge badge-gray" id="contactCount">0</span></div>
          <div class="table-wrap" style="max-height:400px; overflow-y:auto;">
            <table>
              <thead><tr><th>Phone</th><th>Name</th><th>Added</th></tr></thead>
              <tbody id="contactsTableBody"><tr><td colspan="3" style="color:var(--text3);">No contacts yet</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- WEBHOOK -->
    <div class="panel" id="panel-webhook">
      <div class="card">
        <div class="card-title">Your Webhook Endpoint</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Paste this URL into Meta Developer Console → WhatsApp → Configuration → Webhook</p>
        <div class="code-block" id="webhookUrlDisplay">http://localhost:3000/webhook</div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          <input type="text" id="serverDomain" placeholder="https://yourapp.railway.app" style="flex:1;" oninput="updateWebhookUrl()" />
          <button class="btn" onclick="copyWebhook()">Copy URL</button>
        </div>
      </div>

      <div class="col-2">
        <div class="card">
          <div class="card-title">How Replies Work</div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px;">
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div style="width:22px;height:22px;border-radius:50%;background:rgba(37,211,102,0.15);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--green);flex-shrink:0;">1</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.5;">Customer receives your message and types a reply on WhatsApp</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div style="width:22px;height:22px;border-radius:50%;background:rgba(37,211,102,0.15);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--green);flex-shrink:0;">2</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.5;">Meta instantly sends the reply to your Webhook URL as a POST request</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div style="width:22px;height:22px;border-radius:50%;background:rgba(37,211,102,0.15);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--green);flex-shrink:0;">3</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.5;">Your server saves it to the database and it appears in the Inbox instantly</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div style="width:22px;height:22px;border-radius:50%;background:rgba(37,211,102,0.15);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--green);flex-shrink:0;">4</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.5;">You reply back from this portal and it sends via the API</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Free Hosting Options</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="padding:10px;background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border);">
              <div style="font-size:13px;font-weight:500;color:var(--green);">Railway.app</div>
              <div style="font-size:12px;color:var(--text3);margin-top:3px;">Free tier · Deploy in 2 min · Auto public URL</div>
            </div>
            <div style="padding:10px;background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border);">
              <div style="font-size:13px;font-weight:500;color:var(--blue);">Render.com</div>
              <div style="font-size:12px;color:var(--text3);margin-top:3px;">Free tier · Node.js · GitHub deploy</div>
            </div>
            <div style="padding:10px;background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border);">
              <div style="font-size:13px;font-weight:500;color:var(--amber);">Vercel Functions</div>
              <div style="font-size:12px;color:var(--text3);margin-top:3px;">Serverless · Free · Perfect for webhooks</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Webhook Verification Code (Node.js)</div>
        <div class="code-block">// In server.js — already included!
app.get('/webhook', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge); // ✅ Verified!
  } else {
    res.sendStatus(403);
  }
});</div>
      </div>
    </div>

    <!-- SETTINGS -->
    <div class="panel" id="panel-settings">
      <div class="col-2" style="align-items:start;">
        <div class="card">
          <div class="card-title">API Credentials</div>
          <label>Phone Number ID</label>
          <input type="text" id="set-phoneId" placeholder="e.g. 123456789012345" />
          <label>Access Token</label>
          <input type="password" id="set-token" placeholder="EAAxxxxx..." />
          <label>API Version</label>
          <select id="set-version">
            <option value="v20.0">v20.0 (latest)</option>
            <option value="v19.0">v19.0</option>
            <option value="v18.0">v18.0</option>
          </select>
          <label>Webhook Verify Token</label>
          <input type="text" id="set-webhookToken" placeholder="myverifytoken123" />
          <button class="btn btn-green btn-full" style="margin-top:14px;" onclick="saveSettings()">Save Settings</button>
        </div>

        <div>
          <div class="card">
            <div class="card-title">Sending Defaults</div>
            <label>Default Delay Between Messages (ms)</label>
            <input type="number" id="set-delay" value="100" min="50" />
            <p style="font-size:11px;color:var(--text3);margin-top:4px;">100ms = ~600 msg/min. Keep ≥ 80ms to avoid rate limits.</p>
            <label>Cost Per Message (₹)</label>
            <input type="number" id="set-cost" value="0.11" step="0.01" />
            <p style="font-size:11px;color:var(--text3);margin-top:4px;">₹0.11 for Utility/Auth · ₹0.78 for Marketing</p>
            <button class="btn btn-green btn-full" style="margin-top:14px;" onclick="saveSettings()">Save Defaults</button>
          </div>

          <div class="card">
            <div class="card-title">Quick Setup Guide</div>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--text2);">
              <div>1. Create account at <strong style="color:var(--text)">business.facebook.com</strong></div>
              <div>2. Create App → Add WhatsApp product</div>
              <div>3. Add a phone number (new SIM or virtual)</div>
              <div>4. Copy <strong style="color:var(--text)">Phone Number ID</strong> and <strong style="color:var(--text)">Access Token</strong></div>
              <div>5. Deploy this server to Railway/Render</div>
              <div>6. Paste your server URL in the Webhook tab</div>
              <div>7. Add webhook URL in Meta Console</div>
              <div>8. Start sending! 🎉</div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div><!-- /content -->
</div><!-- /main -->

<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<script>
const API = '';  // Same origin — backend serves frontend
let currentPanel = 'dashboard';
let activeCampaignId = null;
let pollInterval = null;
let activePhone = null;
let allConvos = [];
let actChart = null;

// ─── Panel Navigation ─────────────────────────────────────────────────────────
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  const navBtns = document.querySelectorAll('.nav-item');
  const panels = ['dashboard','send','inbox','campaigns','contacts','webhook','settings'];
  navBtns[panels.indexOf(name)]?.classList.add('active');

  const titles = { dashboard:'Dashboard', send:'Send Campaign', inbox:'Inbox', campaigns:'Campaigns', contacts:'Contacts', webhook:'Webhook Setup', settings:'Settings' };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  currentPanel = name;

  if (name === 'dashboard') loadDashboard();
  if (name === 'inbox') loadInbox();
  if (name === 'campaigns') loadCampaigns();
  if (name === 'contacts') loadContacts();
  if (name === 'settings') loadSettings();
}

// ─── API Helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return await res.json();
  } catch (e) { return null; }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const stats = await apiFetch('/api/stats');
  if (!stats) return;

  document.getElementById('s-sent').textContent = Number(stats.totalSent).toLocaleString();
  document.getElementById('s-replies').textContent = Number(stats.totalReplies).toLocaleString();
  document.getElementById('s-failed').textContent = Number(stats.totalFailed).toLocaleString();
  document.getElementById('s-cost').textContent = '₹' + Number(stats.totalCost).toFixed(2);
  document.getElementById('s-unread-sub').textContent = stats.unreadReplies + ' unread';
  document.getElementById('s-campaigns-sub').textContent = stats.totalCampaigns + ' campaigns run';

  if (stats.unreadReplies > 0) {
    document.getElementById('navUnread').textContent = stats.unreadReplies;
    document.getElementById('navUnread').style.display = '';
  }

  // Chart
  const hours = Array.from({length: 24}, (_, i) => i.toString().padStart(2,'0'));
  const counts = hours.map(h => { const f = stats.hourly.find(r => r.hour === h); return f ? f.count : 0; });
  const labels = hours.map(h => \`\${parseInt(h)}\${parseInt(h)<12?'am':'pm'}\`);

  if (actChart) actChart.destroy();
  const ctx = document.getElementById('actChart').getContext('2d');
  actChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Messages Sent', data: counts, backgroundColor: 'rgba(37,211,102,0.3)', borderColor: '#25D366', borderWidth: 1, borderRadius: 3 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: {
      x: { grid: { display: false }, ticks: { color: '#4a6b4e', font: { size: 10 }, maxTicksLimit: 12 } },
      y: { grid: { color: 'rgba(37,211,102,0.05)' }, ticks: { color: '#4a6b4e', font: { size: 10 } } }
    }}
  });

  // Recent campaigns
  const camps = await apiFetch('/api/campaigns');
  const el = document.getElementById('recentCampaigns');
  if (!camps || !camps.length) { el.innerHTML = '<div style="color:var(--text3);font-size:13px;">No campaigns yet</div>'; return; }
  el.innerHTML = camps.slice(0,4).map(c => \`
    <div class="campaign-progress">
      <div class="campaign-row">
        <span style="font-size:13px;font-weight:500;flex:1;">\${c.name}</span>
        <span class="badge \${c.status==='completed'?'badge-green':c.status==='running'?'badge-amber':'badge-gray'}">\${c.status}</span>
      </div>
      <div style="display:flex;gap:12px;font-size:12px;color:var(--text3);margin-bottom:6px;">
        <span>Sent: <b style="color:var(--text)">\${c.sent}/\${c.total}</b></span>
        <span>Failed: <b style="color:var(--red)">\${c.failed}</b></span>
        <span>Cost: <b style="color:var(--amber)">₹\${Number(c.cost).toFixed(2)}</b></span>
      </div>
      <div class="progress-wrap"><div class="progress-fill" style="width:\${c.total>0?Math.round(c.sent/c.total*100):0}%"></div></div>
    </div>\`).join('');
}

// ─── Send Campaign ────────────────────────────────────────────────────────────
function countPhones() {
  const phones = document.getElementById('phoneNumbers').value.trim().split('\\n').filter(l => l.trim().length > 6);
  const cost = parseFloat(document.getElementById('costPerMsg').value) || 0.11;
  const delay = parseInt(document.getElementById('delayMs').value) || 100;
  document.getElementById('phoneCountBadge').textContent = phones.length + ' numbers';
  document.getElementById('estCost').textContent = '₹' + (phones.length * cost).toFixed(2);
  const mins = Math.ceil((phones.length * delay) / 60000);
  document.getElementById('estTime').textContent = \`~\${mins} min\`;
  updatePreview();
}

function updatePreview() {
  const txt = document.getElementById('msgText')?.value || '';
  document.getElementById('previewBubble').textContent = txt || 'Your message will appear here...';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('msgText')?.addEventListener('input', updatePreview);
  document.getElementById('costPerMsg')?.addEventListener('input', countPhones);
  document.getElementById('delayMs')?.addEventListener('input', countPhones);
});

function previewImg() {
  const url = document.getElementById('imageUrl').value.trim();
  const el = document.getElementById('imgPrev');
  el.innerHTML = url ? \`<img class="img-prev" src="\${url}" onerror="this.style.opacity='0.3'" />\` : \`<div class="img-placeholder">No<br>photo</div>\`;
}

function addLog(msg, type = 'info') {
  const box = document.getElementById('sendLog');
  const d = document.createElement('div');
  d.className = 'log-line log-' + type;
  d.textContent = \`[\${new Date().toLocaleTimeString()}] \${msg}\`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

async function startCampaign() {
  const name = document.getElementById('campaignName').value.trim();
  const message = document.getElementById('msgText').value.trim();
  const imageUrl = document.getElementById('imageUrl').value.trim();
  const phones = document.getElementById('phoneNumbers').value.trim().split('\\n').map(l => l.trim()).filter(l => l.length > 6);

  if (!name) { addLog('Please enter a campaign name', 'err'); return; }
  if (!message) { addLog('Please enter a message', 'err'); return; }
  if (!phones.length) { addLog('Please add phone numbers', 'err'); return; }

  document.getElementById('btnSend').disabled = true;
  document.getElementById('btnStop').disabled = false;

  addLog(\`Starting "\${name}" — \${phones.length} recipients\`, 'ok');

  const result = await apiFetch('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({ name, message, image_url: imageUrl, phones })
  });

  if (!result) { addLog('Failed to start campaign', 'err'); document.getElementById('btnSend').disabled = false; return; }

  activeCampaignId = result.campaignId;
  addLog(\`Campaign #\${activeCampaignId} started\`, 'ok');

  // Poll progress
  clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    const camp = await apiFetch(\`/api/campaigns/\${activeCampaignId}\`);
    if (!camp) return;

    const pct = camp.total > 0 ? Math.round(camp.sent / camp.total * 100) : 0;
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progPct').textContent = pct + '%';
    document.getElementById('progLabel').textContent = \`\${camp.sent} of \${camp.total} sent\`;
    document.getElementById('liveSent').textContent = camp.sent;
    document.getElementById('liveFailed').textContent = camp.failed;
    document.getElementById('liveCost').textContent = Number(camp.cost).toFixed(2);

    if (camp.status === 'completed' || camp.status === 'stopped') {
      clearInterval(pollInterval);
      addLog(\`Done! Sent: \${camp.sent}, Failed: \${camp.failed}, Cost: ₹\${Number(camp.cost).toFixed(2)}\`, 'ok');
      document.getElementById('btnSend').disabled = false;
      document.getElementById('btnStop').disabled = true;
    }
  }, 1500);
}

async function stopCampaign() {
  if (!activeCampaignId) return;
  await apiFetch(\`/api/campaigns/\${activeCampaignId}/stop\`, { method: 'POST' });
  clearInterval(pollInterval);
  addLog('Campaign stopped by user', 'info');
  document.getElementById('btnSend').disabled = false;
  document.getElementById('btnStop').disabled = true;
}

// ─── Inbox ────────────────────────────────────────────────────────────────────
async function loadInbox() {
  const convos = await apiFetch('/api/inbox');
  allConvos = convos || [];
  renderConvos(allConvos);
}

function renderConvos(list) {
  const el = document.getElementById('convoList');
  if (!list.length) { el.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:13px;">No conversations yet</div>'; return; }
  el.innerHTML = list.map(c => {
    const init = (c.name || c.phone).slice(-10, -8).toUpperCase() || '??';
    return \`<div class="convo-item \${activePhone===c.phone?'active':''}" onclick="loadChat('\${c.phone}','\${(c.name||'').replace(/'/g,"\\\\'")}')">
      <div class="avatar">\${init}</div>
      <div class="convo-info">
        <div class="convo-name">\${c.name || c.phone}</div>
        <div class="convo-preview">\${c.last_msg || 'No messages'}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <div class="convo-time">\${c.last_time ? new Date(c.last_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}</div>
        \${c.unread > 0 ? '<div class="unread-dot"></div>' : ''}
      </div>
    </div>\`;
  }).join('');
}

function filterConvos(q) {
  const filtered = allConvos.filter(c => (c.name||'').toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
  renderConvos(filtered);
}

async function loadChat(phone, name) {
  activePhone = phone;
  renderConvos(allConvos);
  document.getElementById('chatName').textContent = name || phone;
  document.getElementById('chatPhone').textContent = phone;
  document.getElementById('chatAvatar').textContent = (name || phone).slice(0,2).toUpperCase();
  document.getElementById('chatStatus').style.display = '';
  document.getElementById('replyInput').disabled = false;
  document.getElementById('btnReply').disabled = false;

  const msgs = await apiFetch(\`/api/inbox/\${phone}\`);
  const area = document.getElementById('chatMessages');
  if (!msgs || !msgs.length) { area.innerHTML = '<div style="margin:auto;color:var(--text3);font-size:13px;">No messages yet</div>'; return; }

  area.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'out' || m.dir === 'out';
    const txt = m.content || '';
    const time = new Date(m.timestamp || m.received_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return \`<div class="bubble-wrap \${isOut?'out':'in'}">
      <div class="bubble \${isOut?'out':'in'}">\${txt}</div>
      <div class="bubble-time \${isOut?'out':''}">\${time}\${isOut?' · ✓✓':''}</div>
    </div>\`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

async function sendReply() {
  if (!activePhone) return;
  const input = document.getElementById('replyInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  await apiFetch(\`/api/inbox/\${activePhone}/reply\`, { method: 'POST', body: JSON.stringify({ message: msg }) });
  loadChat(activePhone, document.getElementById('chatName').textContent);
}

// ─── Campaigns Table ──────────────────────────────────────────────────────────
async function loadCampaigns() {
  const camps = await apiFetch('/api/campaigns');
  const tbody = document.getElementById('campaignTableBody');
  if (!camps || !camps.length) { tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text3);">No campaigns yet</td></tr>'; return; }
  tbody.innerHTML = camps.map(c => \`
    <tr>
      <td>\${c.name}</td>
      <td>\${c.sent}</td>
      <td>\${c.delivered}</td>
      <td>—</td>
      <td style="color:var(--red)">\${c.failed}</td>
      <td style="color:var(--amber)">₹\${Number(c.cost).toFixed(2)}</td>
      <td><span class="badge \${c.status==='completed'?'badge-green':c.status==='running'?'badge-amber':'badge-gray'}">\${c.status}</span></td>
      <td style="color:var(--text3)">\${new Date(c.created_at).toLocaleDateString()}</td>
    </tr>\`).join('');
}

// ─── Contacts ─────────────────────────────────────────────────────────────────
async function loadContacts() {
  const contacts = await apiFetch('/api/contacts');
  const tbody = document.getElementById('contactsTableBody');
  document.getElementById('contactCount').textContent = contacts?.length || 0;
  if (!contacts || !contacts.length) { tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text3);">No contacts yet</td></tr>'; return; }
  tbody.innerHTML = contacts.map(c => \`
    <tr>
      <td style="font-family:var(--mono);font-size:12px;">\${c.phone}</td>
      <td>\${c.name || '<span style="color:var(--text3)">—</span>'}</td>
      <td style="color:var(--text3)">\${new Date(c.created_at).toLocaleDateString()}</td>
    </tr>\`).join('');
}

async function importContacts() {
  const phones = document.getElementById('importPhones').value.trim().split('\\n').map(l => l.trim()).filter(Boolean);
  if (!phones.length) return;
  const result = await apiFetch('/api/contacts/import', { method: 'POST', body: JSON.stringify({ phones }) });
  if (result) { alert(\`Imported \${result.imported} contacts\`); loadContacts(); }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await apiFetch('/api/settings');
  if (!s) return;
  document.getElementById('set-phoneId').value = s.phone_number_id || '';
  document.getElementById('set-token').value = s.access_token || '';
  document.getElementById('set-version').value = s.api_version || 'v20.0';
  document.getElementById('set-webhookToken').value = s.webhook_verify_token || '';
  document.getElementById('set-delay').value = s.delay_ms || '100';
  document.getElementById('set-cost').value = s.cost_per_msg || '0.11';

  const configured = !!(s.phone_number_id && s.access_token);
  document.getElementById('apiDot').className = 'dot' + (configured ? '' : ' off');
  document.getElementById('apiStatus').textContent = configured ? 'API connected' : 'Not configured';
}

async function saveSettings() {
  await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      phone_number_id: document.getElementById('set-phoneId').value,
      access_token: document.getElementById('set-token').value,
      api_version: document.getElementById('set-version').value,
      webhook_verify_token: document.getElementById('set-webhookToken').value,
      delay_ms: document.getElementById('set-delay').value,
      cost_per_msg: document.getElementById('set-cost').value,
    })
  });
  await loadSettings();
  alert('Settings saved!');
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
function updateWebhookUrl() {
  const domain = document.getElementById('serverDomain').value.trim().replace(/\\/$/, '');
  document.getElementById('webhookUrlDisplay').textContent = (domain || 'http://localhost:3000') + '/webhook';
}

function copyWebhook() {
  navigator.clipboard.writeText(document.getElementById('webhookUrlDisplay').textContent);
  alert('Webhook URL copied!');
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportSent() { window.open('/api/export/sent'); }
function exportReplies() { window.open('/api/export/replies'); }

// ─── Init ────────────────────────────────────────────────────────────────────
loadDashboard();
setInterval(() => { if (currentPanel === 'dashboard') loadDashboard(); }, 15000);
setInterval(() => { if (currentPanel === 'inbox') loadInbox(); }, 5000);
</script>
</body>
</html>
`;

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
  res.setHeader('Content-Type', 'text/html');
  res.send(FRONTEND_HTML);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ WhatsApp CRM running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Webhook endpoint: http://0.0.0.0:${PORT}/webhook`);
  console.log(`🗄️  Database: whatsapp.db\n`);
});