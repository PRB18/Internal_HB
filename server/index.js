'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'internal-hb') : path.join(__dirname, '..', 'data');
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) && new Date(`${appointment.date}T23:59:59.999Z`) < new Date()) return 'pending';
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
  return { users: [], clients: [], orders: [], inventory: [] };
}
function normalizeOrder(order) {
  const appointment = order.appointment && typeof order.appointment === 'object' ? order.appointment : {};
  return {
    ...order,
    clientNameKey: order.clientNameKey || normalizeName(order.clientName),
    workshopStage: WORKSHOP_STAGES.includes(order.workshopStage) ? order.workshopStage : 'Material',
    delivered: Boolean(order.delivered) || order.workshopStage === 'Delivered',
    orderDate: String(order.orderDate || order.createdAt || '').slice(0, 10),
    trialDate: String(order.trialDate || order.appointment?.date || '').slice(0, 10),
    deliveryDate: String(order.deliveryDate || '').slice(0, 10),
    appointment: {
      date: String(appointment.date || '').trim(),
      state: APPOINTMENT_STATES.includes(appointment.state) ? appointment.state : 'scheduled'
    },
    materials: Array.isArray(order.materials) ? order.materials : [],
    careInstructions: String(order.careInstructions || '').trim()
  };
}
function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return defaultStore();
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, ''));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users) || !Array.isArray(parsed.clients) || !Array.isArray(parsed.orders)) {
    throw new Error(`Invalid data store format in ${DATA_FILE}.`);
  }
  if (!Array.isArray(parsed.inventory)) parsed.inventory = [];
  parsed.orders = parsed.orders.map(normalizeOrder);
  return parsed;
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
if (process.env.VERCEL) app.set('trust proxy', 1);
app.use(session({
  name: 'internal_hb_sid',
  secret: process.env.SESSION_SECRET || 'internal-hb-local-change-me',
  resave: false,
  saveUninitialized: false,
  proxy: Boolean(process.env.VERCEL),
  cookie: { httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL), maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  if (!req.session.user) {
    req.session.user = { id: 'local', username: 'HB', role: 'admin' };
  }
  next();
});
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
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  const name = String(body.name || '').trim();
  const nameKey = normalizeName(name);
  if (!name) return validationError(res, 'Client name is required.');
  if (store.clients.some((client) => client.nameKey === nameKey)) return res.status(409).json({ error: 'A client with this name already exists.' });
  const client = { id: id(), name, nameKey, phone: String(body.phone || '').trim(), email: String(body.email || '').trim(), notes: String(body.notes || '').trim(), careNotes: String(body.careNotes || '').trim(), measurements: {}, measurementUnit: 'in', createdAt: now(), updatedAt: now() };
  store.clients.push(client);
  saveStore();
  res.status(201).json({ client });
});
app.patch('/api/clients/:name', requireAuth, (req, res) => {
  const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  const name = String(body.name ?? client.name).trim();
  const nameKey = normalizeName(name);
  if (!name) return validationError(res, 'Client name is required.');
  if (nameKey !== client.nameKey && store.clients.some((candidate) => candidate.nameKey === nameKey)) return res.status(409).json({ error: 'A client with this name already exists.' });
  store.orders.filter((order) => order.clientNameKey === client.nameKey).forEach((order) => { order.clientName = name; order.clientNameKey = nameKey; });
  Object.assign(client, { name, nameKey, phone: String(body.phone ?? client.phone).trim(), email: String(body.email ?? client.email).trim(), notes: String(body.notes ?? client.notes).trim(), careNotes: String(body.careNotes ?? client.careNotes ?? '').trim(), updatedAt: now() });
  saveStore();
  res.json({ client });
});
app.delete('/api/clients/:name', requireAuth, (req, res) => {
  const index = store.clients.findIndex((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (index < 0) return res.status(404).json({ error: 'Client not found.' });
  const client = store.clients[index];
  if (store.orders.some((order) => order.clientNameKey === client.nameKey)) return res.status(409).json({ error: 'Move or delete this client’s orders before deleting the client.' });
  store.clients.splice(index, 1);
  saveStore();
  res.json({ ok: true });
});
app.get('/api/clients/:name', requireAuth, (req, res) => {
  const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  res.json({ client, orders: store.orders.filter((order) => order.clientNameKey === client.nameKey).map((order) => publicOrder(order, req.session.user.role)) });
});
app.patch('/api/clients/:name/measurements', requireAuth, (req, res) => {
  const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(req.params.name));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body || typeof body.values !== 'object' || Array.isArray(body.values)) return validationError(res, 'Measurement values must be a form object.');
  client.measurements = Object.fromEntries(Object.entries(body.values).map(([key, value]) => [String(key).trim(), String(value).trim()]).filter(([key]) => key));
  client.measurementUnit = body.unit === 'cm' ? 'cm' : 'in';
  client.updatedAt = now();
  saveStore();
  res.json({ client });
});

app.get('/api/orders', requireAuth, (req, res) => {
  const includeDelivered = req.query.includeDelivered === 'true';
  const orders = includeDelivered ? store.orders : store.orders.filter((order) => !order.delivered);
  res.json({ orders: orders.map((order) => publicOrder(order, req.session.user.role)) });
});
app.post('/api/orders', requireAuth, (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  const clientName = String(body.clientName || '').trim();
  const clientNameKey = normalizeName(clientName);
  const client = store.clients.find((candidate) => candidate.nameKey === clientNameKey);
  if (!client) return validationError(res, 'Create or select a client before adding an order.');
  const garment = String(body.garment || '').trim();
  if (!garment) return validationError(res, 'Garment details are required.');
  const apptDate = String(body.appointmentDate || body.trialDate || '').trim();
  const order = {
    id: id(), clientName: client.name, clientNameKey, garment, notes: String(body.notes || '').trim(),
    workshopStage: 'Material', delivered: false, orderDate: String(body.orderDate || now()).slice(0, 10), trialDate: apptDate, deliveryDate: String(body.deliveryDate || '').trim(), appointment: { date: apptDate, state: APPOINTMENT_STATES.includes(body.appointmentState) ? body.appointmentState : 'scheduled' },
    materials: [], careInstructions: String(body.careInstructions || '').trim(),
    totalAmount: req.session.user.role === 'admin' ? Number(body.totalAmount || 0) : 0,
    advancePaid: req.session.user.role === 'admin' ? Number(body.advancePaid || 0) : 0,
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
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  order.appointment = order.appointment && typeof order.appointment === 'object' ? order.appointment : { date: '', state: 'scheduled' };
  if (body.clientName !== undefined) {
    const client = store.clients.find((candidate) => candidate.nameKey === normalizeName(body.clientName));
    if (!client) return validationError(res, 'Client not found.');
    order.clientName = client.name;
    order.clientNameKey = client.nameKey;
  }
  if (body.garment !== undefined) {
    order.garment = String(body.garment).trim();
    if (!order.garment) return validationError(res, 'Garment details are required.');
  }
  if (body.notes !== undefined) order.notes = String(body.notes).trim();
  if (body.careInstructions !== undefined) order.careInstructions = String(body.careInstructions).trim();
  if (body.workshopStage !== undefined) {
    if (!WORKSHOP_STAGES.includes(body.workshopStage)) return validationError(res, 'Unknown workshop stage.');
    order.workshopStage = body.workshopStage;
    order.delivered = body.workshopStage === 'Delivered';
  }
  if (body.orderDate !== undefined) order.orderDate = String(body.orderDate).trim();
  if (body.trialDate !== undefined) { order.trialDate = String(body.trialDate).trim(); order.appointment.date = order.trialDate; }
  if (body.deliveryDate !== undefined) order.deliveryDate = String(body.deliveryDate).trim();
  if (body.appointmentDate !== undefined) { order.appointment.date = String(body.appointmentDate).trim(); order.trialDate = order.appointment.date; }
  if (body.appointmentState !== undefined) {
    if (!APPOINTMENT_STATES.includes(body.appointmentState)) return validationError(res, 'Unknown appointment state.');
    order.appointment.state = body.appointmentState;
  }
  if (req.session.user.role === 'admin') {
    if (body.totalAmount !== undefined) order.totalAmount = Number(body.totalAmount);
    if (body.advancePaid !== undefined) order.advancePaid = Number(body.advancePaid);
    if (!Number.isFinite(order.totalAmount) || !Number.isFinite(order.advancePaid) || order.totalAmount < 0 || order.advancePaid < 0) return validationError(res, 'Financial values must be non-negative numbers.');
  }
  order.updatedAt = now();
  saveStore();
  res.json({ order: publicOrder(order, req.session.user.role) });
});
app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const index = store.orders.findIndex((candidate) => candidate.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Order not found.' });
  (store.orders[index].materials || []).forEach((material) => {
    const item = store.inventory.find((candidate) => candidate.id === material.inventoryId);
    if (item) item.quantity += material.quantity;
  });
  store.orders.splice(index, 1);
  saveStore();
  res.json({ ok: true });
});
app.post('/api/orders/:id/materials', requireAuth, (req, res) => {
  const order = store.orders.find((candidate) => candidate.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  const quantity = Number(body?.quantity);
  const item = store.inventory.find((candidate) => candidate.id === body?.inventoryId);
  if (!item) return validationError(res, 'Inventory item not found.');
  if (!Number.isFinite(quantity) || quantity <= 0) return validationError(res, 'Material quantity must be greater than zero.');
  if (item.quantity < quantity) return validationError(res, `${item.name} only has ${item.quantity} ${item.unit} available.`);
  order.materials = Array.isArray(order.materials) ? order.materials : [];
  if (order.materials.some((material) => material.inventoryId === item.id)) return res.status(409).json({ error: 'This material is already assigned to the order.' });
  item.quantity -= quantity;
  order.materials.push({ inventoryId: item.id, name: item.name, quantity, unit: item.unit });
  order.updatedAt = now();
  saveStore();
  res.status(201).json({ order: publicOrder(order, req.session.user.role), item });
});
app.delete('/api/orders/:id/materials/:inventoryId', requireAuth, (req, res) => {
  const order = store.orders.find((candidate) => candidate.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const index = (order.materials || []).findIndex((material) => material.inventoryId === req.params.inventoryId);
  if (index < 0) return res.status(404).json({ error: 'Material assignment not found.' });
  const material = order.materials[index];
  const item = store.inventory.find((candidate) => candidate.id === material.inventoryId);
  if (item) item.quantity += material.quantity;
  order.materials.splice(index, 1);
  order.updatedAt = now();
  saveStore();
  res.json({ order: publicOrder(order, req.session.user.role) });
});

app.get('/api/inventory', requireAuth, (req, res) => res.json({ inventory: store.inventory.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
app.post('/api/inventory', requireAuth, (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  const name = String(body.name || '').trim();
  const quantity = Number(body.quantity ?? 0);
  if (!name) return validationError(res, 'Material name is required.');
  if (!Number.isFinite(quantity) || quantity < 0) return validationError(res, 'Quantity must be a non-negative number.');
  const item = { id: id(), name, category: String(body.category || 'Fabric').trim(), unit: String(body.unit || 'm').trim(), quantity, reorderAt: Math.max(0, Number(body.reorderAt ?? 0)), supplier: String(body.supplier || '').trim(), notes: String(body.notes || '').trim(), createdAt: now(), updatedAt: now() };
  store.inventory.push(item);
  saveStore();
  res.status(201).json({ item });
});
app.patch('/api/inventory/:id', requireAuth, (req, res) => {
  const item = store.inventory.find((candidate) => candidate.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return validationError(res, 'A JSON object is required.');
  const quantity = Number(body.quantity ?? item.quantity);
  const reorderAt = Number(body.reorderAt ?? item.reorderAt);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderAt) || reorderAt < 0) return validationError(res, 'Quantities must be non-negative numbers.');
  Object.assign(item, { name: String(body.name ?? item.name).trim(), category: String(body.category ?? item.category).trim(), unit: String(body.unit ?? item.unit).trim(), quantity, reorderAt, supplier: String(body.supplier ?? item.supplier).trim(), notes: String(body.notes ?? item.notes).trim(), updatedAt: now() });
  if (!item.name) return validationError(res, 'Material name is required.');
  saveStore();
  res.json({ item });
});
app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  const index = store.inventory.findIndex((candidate) => candidate.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Inventory item not found.' });
  store.inventory.splice(index, 1);
  saveStore();
  res.json({ ok: true });
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

module.exports = { app, appointmentStatus, normalizeOrder, publicOrder, WORKSHOP_STAGES, start, ensureAdmin };
