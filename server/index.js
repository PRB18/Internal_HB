'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3747);
const HOST = '127.0.0.1';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'internal-hb.json');
const WORKSHOP_STAGES = ['Material', 'Cutting', 'Embroidery', 'Hand Work', 'Stitching', 'Fitting', 'Finishing', 'Presentation', 'Delivered'];
const APPOINTMENT_STATES = ['scheduled', 'completed', 'postponed'];

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function normalizeName(name) { return String(name || '').trim().toLocaleLowerCase(); }
function appointmentStatus(appointment) {
  if (!appointment) return 'pending';
  if (appointment.state === 'completed') return 'completed';
  if (appointment.state === 'postponed') return 'postponed';
  if (appointment.date && new Date(`${appointment.date}T23:59:59`) < new Date()) return 'pending';
  return 'scheduled';
}
function publicOrder(order, role) {
  const result = { ...order, appointmentStatus: appointmentStatus(order.appointment) };
  if (role !== 'admin') {
    delete result.totalAmount;
    delete result.advancePaid;
  }
  return result;
}

function defaultStore() {
  return { users: [], clients: [], orders: [] };
}
function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return defaultStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
let store = loadStore();
function saveStore() {
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temporary, DATA_FILE);
}
async function ensureAdmin() {
  if (store.users.length) return;
  store.users.push({
    id: id(),
    username: process.env.INTERNAL_HB_ADMIN_USER || 'admin',
    passwordHash: await bcrypt.hash(process.env.INTERNAL_HB_ADMIN_PASSWORD || 'change-me-now', 12),
    role: 'admin',
    createdAt: now()
  });
  saveStore();
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'internal_hb_sid',
  secret: process.env.SESSION_SECRET || 'internal-hb-local-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required.' });
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function validationError(res, message) { return res.status(400).json({ error: message }); }

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});
app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = store.users.find((candidate) => candidate.username.toLocaleLowerCase() === username.toLocaleLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not create session.' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ user: req.session.user });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/dashboard', requireAuth, (req, res) => {
  const active = store.orders.filter((order) => !order.delivered);
  res.json({
    activeOrders: active.length,
    appointmentsComingUp: active.filter((order) => appointmentStatus(order.appointment) === 'scheduled').length,
    pendingAppointments: active.filter((order) => appointmentStatus(order.appointment) === 'pending').length,
    delivered: store.orders.filter((order) => order.delivered).length,
    recentOrders: active.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((order) => publicOrder(order, req.session.user.role))
  });
});

app.get('/api/clients', requireAuth, (req, res) => {
  res.json({ clients: store.clients.map((client) => ({ ...client, orderCount: store.orders.filter((order) => order.clientNameKey === client.nameKey).length })) });
});
app.post('/api/clients', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const nameKey = normalizeName(name);
  if (!name) return validationError(res, 'Client name is required.');
  if (store.clients.some((client) => client.nameKey === nameKey)) return res.status(409).json({ error: 'A client with this name already exists.' });
  const client = { id: id(), name, nameKey, phone: String(req.body.phone || '').trim(), email: String(req.body.email || '').trim(), notes: String(req.body.notes || '').trim(), measurements: {}, measurementUnit: 'in', createdAt: now(), updatedAt: now() };
  store.clients.push(client);
  saveStore();
  res.status(201).json({ client });
});
app.get('/api/clients/:name', requireAuth, (req, res) => {
  const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  res.json({ client, orders: store.orders.filter((order) => order.clientNameKey === client.nameKey).map((order) => publicOrder(order, req.session.user.role)) });
});
app.patch('/api/clients/:name/measurements', requireAuth, (req, res) => {
  const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  if (!req.body || typeof req.body.values !== 'object' || Array.isArray(req.body.values)) return validationError(res, 'Measurement values must be a form object.');
  client.measurements = Object.fromEntries(Object.entries(req.body.values).map(([key, value]) => [String(key).trim(), String(value).trim()]).filter(([key]) => key));
  client.measurementUnit = req.body.unit === 'cm' ? 'cm' : 'in';
  client.updatedAt = now();
  saveStore();
  res.json({ client });
});

app.get('/api/orders', requireAuth, (req, res) => res.json({ orders: store.orders.filter((order) => !order.delivered).map((order) => publicOrder(order, req.session.user.role)) }));
app.post('/api/orders', requireAuth, (req, res) => {
  const clientName = String(req.body?.clientName || '').trim();
  const clientNameKey = normalizeName(clientName);
  const client = store.clients.find((candidate) => candidate.nameKey === clientNameKey);
  if (!client) return validationError(res, 'Create or select a client before adding an order.');
  const garment = String(req.body?.garment || '').trim();
  if (!garment) return validationError(res, 'Garment details are required.');
  const order = {
    id: id(), clientName: client.name, clientNameKey, garment, notes: String(req.body.notes || '').trim(),
    workshopStage: 'Material', delivered: false, appointment: { date: String(req.body.appointmentDate || '').trim(), state: APPOINTMENT_STATES.includes(req.body.appointmentState) ? req.body.appointmentState : 'scheduled' },
    totalAmount: req.session.user.role === 'admin' ? Number(req.body.totalAmount || 0) : 0,
    advancePaid: req.session.user.role === 'admin' ? Number(req.body.advancePaid || 0) : 0,
    createdAt: now(), updatedAt: now()
  };
  if (!Number.isFinite(order.totalAmount) || !Number.isFinite(order.advancePaid) || order.totalAmount < 0 || order.advancePaid < 0) return validationError(res, 'Financial values must be non-negative numbers.');
  store.orders.push(order);
  saveStore();
  res.status(201).json({ order: publicOrder(order, req.session.user.role) });
});
app.patch('/api/orders/:id', requireAuth, (req, res) => {
  const order = store.orders.find((candidate) => candidate.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (req.body.workshopStage !== undefined) {
    if (!WORKSHOP_STAGES.includes(req.body.workshopStage)) return validationError(res, 'Unknown workshop stage.');
    order.workshopStage = req.body.workshopStage;
    order.delivered = req.body.workshopStage === 'Delivered';
  }
  if (req.body.appointmentDate !== undefined) order.appointment.date = String(req.body.appointmentDate).trim();
  if (req.body.appointmentState !== undefined) {
    if (!APPOINTMENT_STATES.includes(req.body.appointmentState)) return validationError(res, 'Unknown appointment state.');
    order.appointment.state = req.body.appointmentState;
  }
  if (req.session.user.role === 'admin') {
    if (req.body.totalAmount !== undefined) order.totalAmount = Number(req.body.totalAmount);
    if (req.body.advancePaid !== undefined) order.advancePaid = Number(req.body.advancePaid);
    if (!Number.isFinite(order.totalAmount) || !Number.isFinite(order.advancePaid) || order.totalAmount < 0 || order.advancePaid < 0) return validationError(res, 'Financial values must be non-negative numbers.');
  }
  order.updatedAt = now();
  saveStore();
  res.json({ order: publicOrder(order, req.session.user.role) });
});

app.get('/api/meta', requireAuth, (req, res) => res.json({ workshopStages: WORKSHOP_STAGES, appointmentStates: APPOINTMENT_STATES, role: req.session.user.role }));
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => res.json({ users: store.users.map(({ id: userId, username, role, createdAt }) => ({ id: userId, username, role, createdAt })) }));
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'staff';
  if (!username || password.length < 8) return validationError(res, 'Username and a password of at least 8 characters are required.');
  if (store.users.some((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase())) return res.status(409).json({ error: 'Username already exists.' });
  const user = { id: id(), username, passwordHash: await bcrypt.hash(password, 12), role, createdAt: now() };
  store.users.push(user);
  saveStore();
  res.status(201).json({ user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt } });
});

async function start() {
  await ensureAdmin();
  return app.listen(PORT, HOST, () => console.log(`Internal HB listening at http://${HOST}:${PORT}`));
}

if (require.main === module) {
  start().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { app, appointmentStatus, publicOrder, WORKSHOP_STAGES, start };
