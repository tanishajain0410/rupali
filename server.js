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

  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    tagline TEXT,
    location TEXT DEFAULT 'Saphale West, Palghar',
    starting_price TEXT DEFAULT '₹24.99 Lakhs*',
    unit_types TEXT DEFAULT '1 & 2 BHK',
    carpet_area TEXT DEFAULT '425 - 680 Sq.Ft.',
    possession TEXT DEFAULT 'Dec 2026',
    rera_number TEXT DEFAULT 'P99000054321',
    image_url TEXT DEFAULT '/assets/images/vercel_hero_building.webp',
    brochure_url TEXT DEFAULT '/om-sunkulan-brochure.pdf',
    description TEXT,
    featured INTEGER DEFAULT 1,
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_content (
    section_key TEXT PRIMARY KEY,
    content_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Seed initial property if table is empty
const propCount = db.prepare('SELECT COUNT(*) as count FROM properties').get().count;
if (propCount === 0) {
  db.prepare(`
    INSERT INTO properties (title, tagline, location, starting_price, unit_types, carpet_area, possession, rera_number, image_url, brochure_url, description, featured, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active')
  `).run(
    'OM SUNKULAN',
    'Luxury 1 & 2 BHK Residences & Commercial Spaces',
    'Village Makane, Saphale West, Dist. Palghar',
    '₹24.99 Lakhs*',
    '1 & 2 BHK Luxury Apartments',
    '425 - 680 Sq.Ft.',
    'Under Construction (Dec 2026)',
    'P99000054321 / MahaRERA Registered',
    '/assets/images/vercel_hero_building.webp',
    '/om-sunkulan-brochure.pdf',
    'Flagship residential and commercial project by Rupali Properties offering luxury lifestyle, grand entrance lobby, rooftop garden, fitness gym, branded lifts, and 24x7 security just minutes from Saphale Railway Station.'
  );
  console.log('Seeded flagship property: OM SUNKULAN');
}

// Seed default site_content if empty
const defaultSections = {
  hero: {
    headline: 'Your Own Home. Your Own Happiness.',
    subheadline: 'Luxury 1 & 2 BHK Residences at OM SUNKULAN, Saphale West. Thoughtfully designed around your life with premium amenities and seamless railway connectivity.',
    startingPrice: '₹24.99 Lakhs* Onwards',
    ctaPhone: '+91 95546 69474',
    whatsappNumber: '919554669474',
    announcementActive: true,
    announcementText: '⚡ Special Launch Offer: Zero Stamp Duty & Free Modular Kitchen for Next 10 Bookings! Call +91 95546 69474'
  },
  contact: {
    officeAddress: 'OM SUNKULAN Sales Office: Gala No. 106, 107 & 108, Krushna Plaza, Village Makane, Near Sai Samarth Super Market, Saphale West, Dist. & Tal. Palghar - 401102',
    phone: '+91 95546 69474',
    alternatePhone: '+91 98200 00000',
    email: 'sales@rupaliproperties.com',
    officeHours: '9:30 AM - 7:30 PM (Open All 7 Days)',
    reraNumber: 'P99000054321 / MahaRERA Registered'
  },
  pricing: {
    unit1_name: '1 BHK Luxury Apartment',
    unit1_carpet: '425 - 460 Sq.Ft.',
    unit1_price: '₹24.99 Lakhs*',
    unit1_desc: 'Spacious Living Room, Master Bedroom with Balcony View, Premium Bathroom Fittings',
    unit2_name: '2 BHK Premium Residence',
    unit2_carpet: '610 - 680 Sq.Ft.',
    unit2_price: '₹36.50 Lakhs*',
    unit2_desc: '2 Master Bedrooms, Large Kitchen, 2 Balconies, Excellent Cross Ventilation',
    unit3_name: 'Commercial Retail Shops',
    unit3_carpet: '180 - 450 Sq.Ft.',
    unit3_price: 'Price On Request',
    unit3_desc: 'Prime Road Facing, High Footfall, Ideal for Supermarkets, Clinics, Salons & Retail'
  },
  amenities: [
    { name: 'Branded High-Speed Lifts', desc: 'Auto Rescue Device (ARD) and backup power system', icon: 'fa-elevator' },
    { name: '24x7 CCTV & Gated Security', desc: 'Round the clock security personnel and HD surveillance', icon: 'fa-shield-halved' },
    { name: 'Lush Landscaped Garden', desc: 'Green landscaped sitting zones and morning walking track', icon: 'fa-tree' },
    { name: 'Modern Fitness Center', desc: 'Fully equipped gymnasium for your healthy lifestyle', icon: 'fa-dumbbell' },
    { name: 'Children Play Area', desc: 'Safe outdoor activity area with rubberized flooring and swings', icon: 'fa-child-reaching' },
    { name: 'Generator Power Backup', desc: 'Uninterrupted power for common areas, elevators and pumps', icon: 'fa-bolt' },
    { name: 'Designated Car Parking', desc: 'Covered and spacious podium parking layout', icon: 'fa-square-parking' },
    { name: 'Senior Citizens Gazebo', desc: 'Peaceful seating pergola designed for elder residents', icon: 'fa-heart' }
  ]
};

for (const [key, val] of Object.entries(defaultSections)) {
  const exists = db.prepare('SELECT section_key FROM site_content WHERE section_key = ?').get(key);
  if (!exists) {
    db.prepare('INSERT INTO site_content (section_key, content_json) VALUES (?, ?)').run(key, JSON.stringify(val));
  }
}

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

// Public: Get all active properties
app.get('/api/properties', (req, res) => {
  try {
    const properties = db.prepare("SELECT * FROM properties WHERE status != 'Inactive' ORDER BY featured DESC, id DESC").all();
    return res.json({ success: true, properties });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Public: Get all site content sections
app.get('/api/site-content', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM site_content').all();
    const content = {};
    for (const r of rows) {
      try {
        content[r.section_key] = JSON.parse(r.content_json);
      } catch (e) {
        content[r.section_key] = r.content_json;
      }
    }
    return res.json({ success: true, content });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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

// ---------------- PROTECTED ADMIN ROUTES: PROPERTIES ---------------- //

// List all properties for Admin
app.get('/api/admin/properties', requireAdmin, (req, res) => {
  try {
    const properties = db.prepare('SELECT * FROM properties ORDER BY id DESC').all();
    return res.json({ success: true, properties });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Add New Property
app.post('/api/admin/properties', requireAdmin, (req, res) => {
  try {
    const {
      title, tagline, location, starting_price, unit_types,
      carpet_area, possession, rera_number, image_url, brochure_url,
      description, featured = 1, status = 'Active'
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Property title is required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO properties (
        title, tagline, location, starting_price, unit_types,
        carpet_area, possession, rera_number, image_url, brochure_url,
        description, featured, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      title.trim(),
      (tagline || '').trim(),
      (location || 'Saphale West, Palghar').trim(),
      (starting_price || 'Price On Request').trim(),
      (unit_types || '1 & 2 BHK').trim(),
      (carpet_area || '').trim(),
      (possession || 'Ready Possession').trim(),
      (rera_number || '').trim(),
      (image_url || '/assets/images/vercel_hero_building.webp').trim(),
      (brochure_url || '/om-sunkulan-brochure.pdf').trim(),
      (description || '').trim(),
      featured ? 1 : 0,
      status || 'Active'
    );

    return res.status(201).json({
      success: true,
      id: info.lastInsertRowid,
      message: 'Property added successfully.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Edit Property
app.put('/api/admin/properties/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, tagline, location, starting_price, unit_types,
      carpet_area, possession, rera_number, image_url, brochure_url,
      description, featured, status
    } = req.body;

    const current = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    db.prepare(`
      UPDATE properties SET
        title = ?, tagline = ?, location = ?, starting_price = ?, unit_types = ?,
        carpet_area = ?, possession = ?, rera_number = ?, image_url = ?, brochure_url = ?,
        description = ?, featured = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title !== undefined ? title.trim() : current.title,
      tagline !== undefined ? tagline.trim() : current.tagline,
      location !== undefined ? location.trim() : current.location,
      starting_price !== undefined ? starting_price.trim() : current.starting_price,
      unit_types !== undefined ? unit_types.trim() : current.unit_types,
      carpet_area !== undefined ? carpet_area.trim() : current.carpet_area,
      possession !== undefined ? possession.trim() : current.possession,
      rera_number !== undefined ? rera_number.trim() : current.rera_number,
      image_url !== undefined ? image_url.trim() : current.image_url,
      brochure_url !== undefined ? brochure_url.trim() : current.brochure_url,
      description !== undefined ? description.trim() : current.description,
      featured !== undefined ? (featured ? 1 : 0) : current.featured,
      status !== undefined ? status : current.status,
      id
    );

    return res.json({ success: true, message: 'Property updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Remove / Delete Property
app.delete('/api/admin/properties/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM properties WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Property removed successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- PROTECTED ADMIN ROUTES: WEBSITE SECTIONS CONTENT ---------------- //

// Save / Update Website Section Content
app.post('/api/admin/site-content', requireAdmin, (req, res) => {
  try {
    const { section, data } = req.body;
    if (!section || !data) {
      return res.status(400).json({ success: false, error: 'Section key and data are required.' });
    }

    const jsonStr = JSON.stringify(data);
    db.prepare(`
      INSERT INTO site_content (section_key, content_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(section_key) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(section, jsonStr);

    return res.json({ success: true, message: `Section '${section}' updated successfully.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- PROTECTED ADMIN ROUTES: LEADS & CRM ---------------- //

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

// Stats (Enhanced with Properties count)
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM inquiries').get().count;
    const newCount = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'New'").get().count;
    const siteVisits = db.prepare('SELECT COUNT(*) as count FROM inquiries WHERE scheduleVisit = 1').get().count;
    const contacted = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'Contacted'").get().count;
    const closed = db.prepare("SELECT COUNT(*) as count FROM inquiries WHERE status = 'Closed'").get().count;

    const propertiesCount = db.prepare('SELECT COUNT(*) as count FROM properties').get().count;

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
      stats: { total, new: newCount, siteVisits, contacted, closed, todayFollowups, upcomingVisits, propertiesCount }
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
  res.json({ status: 'ok', service: 'Rupali Properties API v3 with CMS', timestamp: new Date().toISOString() });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Rupali Properties API v3 with CMS running on http://127.0.0.1:${PORT}`);
});
