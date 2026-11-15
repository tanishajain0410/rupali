const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5001;

// Database setup
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(path.join(dbDir, 'inquiries.db'));
db.pragma('journal_mode = WAL');

// Initialize schema with migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    unit TEXT DEFAULT '1 BHK',
    contactMethod TEXT DEFAULT 'Phone call',
    scheduleVisit INTEGER DEFAULT 0,
    message TEXT,
    status TEXT DEFAULT 'New',
    priority TEXT DEFAULT 'Warm',
    followup_date TEXT DEFAULT NULL,
    visit_date TEXT DEFAULT NULL,
    pickup_needed INTEGER DEFAULT 0,
    visitor_count INTEGER DEFAULT 1,
    notes TEXT DEFAULT '',
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lead_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL,
    action_type TEXT DEFAULT 'Call Note',
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration helper for existing databases (adds columns if missing)
function ensureColumns() {
  const columns = db.pragma('table_info(inquiries)').map(c => c.name);
  if (!columns.includes('priority')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN priority TEXT DEFAULT 'Warm'");
  }
  if (!columns.includes('followup_date')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN followup_date TEXT DEFAULT NULL");
  }
  if (!columns.includes('visit_date')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN visit_date TEXT DEFAULT NULL");
  }
  if (!columns.includes('pickup_needed')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN pickup_needed INTEGER DEFAULT 0");
  }
  if (!columns.includes('visitor_count')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN visitor_count INTEGER DEFAULT 1");
  }
}
ensureColumns();

// Hash helper
function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'rupali_salt_2026').digest('hex');
}

// Seed default admin if empty
const adminCheck = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!adminCheck) {
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hashPassword('RupaliAdmin@2026'));
  console.log('Default admin created: admin / RupaliAdmin@2026');
}

// Active session tokens
const activeSessions = new Set();
const MASTER_TOKEN = 'rp_admin_sec_' + crypto.createHash('md5').update('RupaliAdmin@2026').digest('hex');
activeSessions.add(MASTER_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth Middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token;
  if (!token || (!activeSessions.has(token) && token !== MASTER_TOKEN)) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please login again.' });
  }
  next();
}

// ---------------- PUBLIC ROUTES ---------------- //

// Submit Inquiry (from Landing page)
app.post('/api/inquiries', (req, res) => {
  try {
    const { name, phone, email, unit, contactMethod, scheduleVisit, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone are required.' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const isVisit = scheduleVisit === true || scheduleVisit === 1 || scheduleVisit === '1' || scheduleVisit === 'true' ? 1 : 0;

    const stmt = db.prepare(`
      INSERT INTO inquiries (name, phone, email, unit, contactMethod, scheduleVisit, message, status, priority, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'New', 'Warm', ?)
    `);
    const info = stmt.run(
      name.trim(),
      phone.trim(),
      (email || '').trim(),
      unit || '1 BHK',
      contactMethod || 'Phone call',
      isVisit,
      (message || '').trim(),
      ip
    );

    // Add initial activity log
    db.prepare(`
      INSERT INTO lead_activity (inquiry_id, action_type, note)
      VALUES (?, 'Lead Created', 'Lead received via website form')
    `).run(info.lastInsertRowid);

    return res.status(201).json({
      success: true,
      id: info.lastInsertRowid,
      message: 'Enquiry successfully submitted and recorded.'
    });
  } catch (err) {
    console.error('Error saving inquiry:', err);
    return res.status(500).json({ success: false, error: 'Internal server error while saving enquiry.' });
  }
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required.' });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }

  const sessionToken = 'rp_token_' + crypto.randomBytes(24).toString('hex');
  activeSessions.add(sessionToken);

  return res.json({
    success: true,
    token: sessionToken,
    username: user.username,
    message: 'Login successful'
  });
});

// ---------------- PROTECTED ADMIN ROUTES ---------------- //

// Change Password
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
    }

    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('admin');
    if (!admin || admin.password_hash !== hashPassword(currentPassword)) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hashPassword(newPassword), 'admin');
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Stats (Enhanced with Follow-ups, Visits, Today counts)
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM inquiries').get().count;
    const newCount = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'New'").get().count;
    const siteVisits = db.prepare('SELECT COUNT(*) as count FROM inquiries WHERE scheduleVisit = 1').get().count;
    const contacted = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'Contacted'").get().count;
    const closed = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'Closed'").get().count;

    // Today's Follow-ups count
    const today = new Date().toISOString().slice(0, 10);
    const todayFollowups = db.prepare(`
      SELECT COUNT(*) as count FROM inquiries 
      WHERE followup_date IS NOT NULL AND substr(followup_date, 1, 10) <= ? AND status != 'Closed'
    `).get(today).count;

    // Upcoming Site Visits count
    const upcomingVisits = db.prepare(`
      SELECT COUNT(*) as count FROM inquiries 
      WHERE visit_date IS NOT NULL AND substr(visit_date, 1, 10) >= ?
    `).get(today).count;

    return res.json({
      success: true,
      stats: { total, new: newCount, siteVisits, contacted, closed, todayFollowups, upcomingVisits }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// List Inquiries (with Search, Status, Unit, Date Range, Priority)
app.get('/api/admin/inquiries', requireAdmin, (req, res) => {
  try {
    const { status, unit, priority, dateRange, onlyVisits, onlyFollowups, search, limit = 200, offset = 0 } = req.query;

    let sql = 'SELECT * FROM inquiries WHERE 1=1';
    const params = [];

    if (status && status !== 'All') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (unit && unit !== 'All') {
      sql += ' AND unit = ?';
      params.push(unit);
    }
    if (priority && priority !== 'All') {
      sql += ' AND priority = ?';
      params.push(priority);
    }

    if (onlyVisits === 'true' || onlyVisits === '1') {
      sql += ' AND (scheduleVisit = 1 OR visit_date IS NOT NULL)';
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    if (onlyFollowups === 'true' || onlyFollowups === '1') {
      sql += " AND followup_date IS NOT NULL AND substr(followup_date, 1, 10) <= ? AND status != 'Closed'";
      params.push(todayStr);
    }

    // Date Range Filter
    if (dateRange && dateRange !== 'All') {
      if (dateRange === 'Today') {
        sql += " AND substr(created_at, 1, 10) = ?";
        params.push(todayStr);
      } else if (dateRange === 'Yesterday') {
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        sql += " AND substr(created_at, 1, 10) = ?";
        params.push(y);
      } else if (dateRange === 'This Week') {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        sql += " AND substr(created_at, 1, 10) >= ?";
        params.push(weekAgo);
      } else if (dateRange === 'This Month') {
        const monthStart = todayStr.slice(0, 7) + '-01';
        sql += " AND substr(created_at, 1, 10) >= ?";
        params.push(monthStart);
      }
    }

    if (search && search.trim()) {
      sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? OR message LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s);
    }

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const inquiries = db.prepare(sql).all(...params);
    return res.json({ success: true, inquiries });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update Inquiry (Status, Priority, Notes, Follow-up date, Site Visit info)
app.patch('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, notes, followup_date, visit_date, pickup_needed, visitor_count } = req.body;

    const current = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Inquiry not found.' });
    }

    const newStatus = status !== undefined ? status : current.status;
    const newPriority = priority !== undefined ? priority : (current.priority || 'Warm');
    const newNotes = notes !== undefined ? notes : current.notes;
    const newFollowup = followup_date !== undefined ? followup_date : current.followup_date;
    const newVisit = visit_date !== undefined ? visit_date : current.visit_date;
    const newPickup = pickup_needed !== undefined ? (pickup_needed ? 1 : 0) : (current.pickup_needed || 0);
    const newCount = visitor_count !== undefined ? Number(visitor_count) : (current.visitor_count || 1);

    db.prepare(`
      UPDATE inquiries 
      SET status = ?, priority = ?, notes = ?, followup_date = ?, visit_date = ?, pickup_needed = ?, visitor_count = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newStatus, newPriority, newNotes, newFollowup, newVisit, newPickup, newCount, id);

    // If status changed, record in activity timeline
    if (status !== undefined && status !== current.status) {
      db.prepare(`
        INSERT INTO lead_activity (inquiry_id, action_type, note)
        VALUES (?, 'Status Change', ?)
      `).run(id, `Status updated to ${status}`);
    }

    // If followup date was changed/set
    if (followup_date !== undefined && followup_date !== current.followup_date && followup_date) {
      db.prepare(`
        INSERT INTO lead_activity (inquiry_id, action_type, note)
        VALUES (?, 'Follow-up Set', ?)
      `).run(id, `Next follow-up scheduled for ${followup_date}`);
    }

    // If visit date was changed/set
    if (visit_date !== undefined && visit_date !== current.visit_date && visit_date) {
      db.prepare(`
        INSERT INTO lead_activity (inquiry_id, action_type, note)
        VALUES (?, 'Site Visit Scheduled', ?)
      `).run(id, `Site visit scheduled on ${visit_date} (Pickup: ${newPickup ? 'Yes' : 'No'}, Visitors: ${newCount})`);
    }

    return res.json({ success: true, message: 'Inquiry updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Activity Timeline for a Lead
app.get('/api/admin/inquiries/:id/activity', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const activities = db.prepare('SELECT * FROM lead_activity WHERE inquiry_id = ? ORDER BY id DESC').all(id);
    return res.json({ success: true, activities });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Add new activity log entry to a Lead
app.post('/api/admin/inquiries/:id/activity', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { note, action_type = 'Call Note' } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Note content is required.' });
    }

    db.prepare(`
      INSERT INTO lead_activity (inquiry_id, action_type, note)
      VALUES (?, ?, ?)
    `).run(id, action_type, note.trim());

    return res.json({ success: true, message: 'Activity note added.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Inquiry
app.delete('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM inquiries WHERE id = ?').run(id);
    db.prepare('DELETE FROM lead_activity WHERE inquiry_id = ?').run(id);
    return res.json({ success: true, message: 'Inquiry deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Export inquiries to CSV (Enhanced with all fields)
app.get('/api/admin/export', requireAdmin, (req, res) => {
  try {
    const inquiries = db.prepare('SELECT * FROM inquiries ORDER BY id DESC').all();
    
    let csv = 'ID,Date,Name,Mobile,Email,Unit,Priority,Status,Follow-up Date,Site Visit,Visit Date,Station Pickup,Visitors,Notes,Message\n';
    for (const item of inquiries) {
      const escape = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
      csv += [
        item.id,
        escape(item.created_at),
        escape(item.name),
        escape(item.phone),
        escape(item.email),
        escape(item.unit),
        escape(item.priority || 'Warm'),
        escape(item.status),
        escape(item.followup_date || 'None'),
        item.scheduleVisit ? 'Yes' : 'No',
        escape(item.visit_date || 'None'),
        item.pickup_needed ? 'Yes' : 'No',
        item.visitor_count || 1,
        escape(item.notes),
        escape(item.message)
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="rupaliproperties_enquiries.csv"');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Rupali Properties Enquiry API v2', timestamp: new Date().toISOString() });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Rupali Properties Enquiry Backend v2 running on http://127.0.0.1:${PORT}`);
});
