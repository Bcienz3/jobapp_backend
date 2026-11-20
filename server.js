const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
const JWT_SECRET = 'cambia-questa-chiave';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ---------- Database (file persistente jobboard.db) ----------
const db = new Database(path.join(__dirname, 'jobboard.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  cv_file TEXT NOT NULL,
  cv_original_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- Upload curriculum ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  try {
    req.company = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Sessione non valida, rifai il login' });
  }
}

// R1 - Registrazione azienda
app.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Compila tutti i campi' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
  }
  const mail = String(email).toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM companies WHERE email = ?').get(mail);
  if (exists) return res.status(409).json({ error: 'Email già registrata' });
  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare('INSERT INTO companies (name, email, password_hash) VALUES (?, ?, ?)')
    .run(String(name).trim(), mail, hash);
  res.status(201).json({ message: 'Account creato' });
});

// R2 - Login azienda
app.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Inserisci email e password' });
  const company = db.prepare('SELECT * FROM companies WHERE email = ?')
    .get(String(email).toLowerCase().trim());
  if (!company || !bcrypt.compareSync(String(password), company.password_hash)) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  const token = jwt.sign({ id: company.id, name: company.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, name: company.name });
});

// R5 - Bacheca pubblica
app.get('/jobs', (req, res) => {
  const rows = db.prepare(`
    SELECT j.id, j.title, j.description, j.location, j.created_at, c.name AS company_name
    FROM jobs j JOIN companies c ON c.id = j.company_id
    ORDER BY j.id DESC
  `).all();
  res.json(rows);
});

app.get('/jobs/:id', (req, res) => {
  const row = db.prepare(`
    SELECT j.id, j.title, j.description, j.location, j.created_at, c.name AS company_name
    FROM jobs j JOIN companies c ON c.id = j.company_id
    WHERE j.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Annuncio non trovato' });
  res.json(row);
});

// R4 - Pubblicazione annuncio
app.post('/jobs', auth, (req, res) => {
  const { title, description, location } = req.body || {};
  if (!title || !description) {
    return res.status(400).json({ error: 'Titolo e descrizione sono obbligatori' });
  }
  const info = db.prepare(
    'INSERT INTO jobs (company_id, title, description, location) VALUES (?, ?, ?, ?)'
  ).run(req.company.id, String(title).trim(), String(description).trim(), location ? String(location).trim() : null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// R7 - Annunci dell'azienda (con numero di candidature)
app.get('/my-jobs', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT j.id, j.title, j.description, j.location, j.created_at,
           (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applications_count
    FROM jobs j WHERE j.company_id = ? ORDER BY j.id DESC
  `).all(req.company.id);
  res.json(rows);
});

// R7 - Candidature di un proprio annuncio
app.get('/jobs/:id/applications', auth, (req, res) => {
  const job = db.prepare('SELECT id FROM jobs WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.company.id);
  if (!job) return res.status(404).json({ error: 'Annuncio non trovato' });
  const rows = db.prepare('SELECT * FROM applications WHERE job_id = ? ORDER BY id DESC').all(job.id);
  res.json(rows);
});

// R6 - Candidatura (multipart: campi + file "cv")
app.post('/jobs/:id/apply', upload.single('cv'), (req, res) => {
  const fail = (code, msg) => {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(code).json({ error: msg });
  };
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return fail(404, 'Annuncio non trovato');
  const { first_name, last_name, email, phone, message } = req.body || {};
  if (!first_name || !last_name || !email) return fail(400, 'Nome, cognome ed email sono obbligatori');
  if (!req.file) return fail(400, 'Allega il curriculum');
  db.prepare(`
    INSERT INTO applications (job_id, first_name, last_name, email, phone, message, cv_file, cv_original_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(job.id, first_name.trim(), last_name.trim(), email.trim(),
         phone || null, message || null, req.file.filename, req.file.originalname);
  res.status(201).json({ message: 'Candidatura registrata' });
});

// Errori (es. file troppo grande)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Errore' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});