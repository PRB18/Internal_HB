const app = document.querySelector('#app');
const state = {
  user: { id: 'local', username: 'HB', role: 'admin' },
  route: 'dashboard',
  stages: [],
  activeClient: null,
  workshopStageFilter: 'all'
};
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function toast(message, type = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

function confirmAction(message) {
  return new Promise((resolve) => {
    const node = modal('Confirm action', `<p class="modal-intro">${esc(message)}</p><div class="actions">${button('Cancel', 'type="button" data-cancel')}${button('Confirm', 'type="button" data-confirm', 'primary')}</div>`);
    const finish = (result) => {
      node.remove();
      resolve(result);
    };
    node.querySelector('[data-close]').onclick = () => finish(false);
    node.querySelector('[data-cancel]').onclick = () => finish(false);
    node.querySelector('[data-confirm]').onclick = () => finish(true);
    node.onclick = (event) => { if (event.target === node) finish(false); };
  });
}

function navItems() {
  return [
    ['dashboard', 'Overview'],
    ['clients', 'Client profiles'],
    ['measurements', 'Measurements'],
    ['inventory', 'Inventory'],
    ['schedule', 'Schedule'],
    ['orders', 'Orders'],
    ['workshop', 'Workshop'],
    ['status', 'Status quo'],
    ['care', 'Care support']
  ];
}

function shell(content, active = state.route) {
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand">Internal HB<small>atelier operations</small></div><nav class="nav">${navItems().map(([route, label]) => `<button class="${active === route ? 'active' : ''}" data-route="${route}"><span>${label}</span></button>`).join('')}</nav><div class="sidebar-footer"><div class="user-chip"><span class="avatar">${esc(state.user.username.slice(0, 1).toUpperCase())}</span><span>${esc(state.user.username)}<small>${esc(state.user.role)}</small></span></div></div></aside><main class="content">${content}</main></div>`;
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.route === 'workshop') state.workshopStageFilter = 'all';
      navigate(btn.dataset.route);
    };
  });
}

function header(kicker, title, subtitle, action = '') {
  return `<header class="topbar"><div><div class="eyebrow">${esc(kicker)}</div><h1 class="title">${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="header-actions">${action}</div></header>`;
}

function button(label, attrs = '', kind = '') {
  return `<button class="button ${kind}" ${attrs}>${esc(label)}</button>`;
}

function empty(title, copy, action = '') {
  return `<div class="empty-state"><div class="empty-mark">○</div><h3>${esc(title)}</h3><p>${esc(copy)}</p>${action}</div>`;
}

function modal(title, body) {
  const node = document.createElement('div');
  node.className = 'modal-backdrop';
  node.innerHTML = `<section class="modal panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><button class="modal-close" aria-label="Close modal" data-close>×</button><h2>${esc(title)}</h2>${body}</section>`;
  document.body.append(node);
  node.querySelector('[data-close]').onclick = () => node.remove();
  node.onclick = (event) => { if (event.target === node) node.remove(); };
  return node;
}

function formField(label, name, value = '', type = 'text', extra = '') {
  return `<div class="field"><label>${esc(label)}</label><input type="${type}" name="${esc(name)}" value="${esc(value)}" ${extra}></div>`;
}

function apptStatusLabel(order) {
  const s = order.appointmentStatus;
  if (s === 'completed') return ['done', 'Done'];
  if (s === 'pending' && order.appointment?.date) return ['pending', 'Pending'];
  if (s === 'scheduled' && order.appointment?.date) return ['scheduled', 'Upcoming'];
  if (s === 'postponed') return ['postponed', 'Postponed'];
  if (s === 'pending') return ['pending', 'Pending'];
  return ['', '—'];
}

function apptDisplayBadge(order) {
  const [cls, label] = apptStatusLabel(order);
  if (!cls) return '—';
  return `<span class="badge ${esc(cls)}">${esc(label)}</span>`;
}

async function refreshCurrentView() {
  if (state.route === 'clients' && state.activeClient) {
    await clientProfile(state.activeClient);
  } else {
    await navigate(state.route);
  }
}

async function renderDashboard() {
  state.activeClient = null;
  const data = await api('/api/dashboard');
  const { clients } = await api('/api/clients');
  shell(
    `${header('Atelier workspace', `Good work, ${state.user.username}.`, 'A clear morning view of clients, fittings, materials, and garments in motion.', button('New order', 'id="new-order"', 'primary'))}
    <section class="stat-grid">
      <div class="stat-card accent"><span>Active orders</span><strong>${data.activeOrders}</strong><small>Currently in the house</small></div>
      <div class="stat-card"><span>Clients</span><strong>${clients.length}</strong><small>In your directory</small></div>
    </section>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="section-heading"><div><div class="eyebrow">Live work</div><h2>Recent orders</h2></div>${button('View all', 'id="view-orders"', 'link')}</div>
        ${orderTable(data.recentOrders)}
      </section>
      <section class="panel welcome-panel">
        <div class="eyebrow">Your atelier, organised</div>
        <h2>Keep every detail close.</h2>
        <p>Build client profiles, keep measurements reusable, plan fittings, track materials, and move garments through the workshop without losing context.</p>
        <div class="quick-actions">${button('Add client', 'id="quick-client"', 'gold')}${button('Add material', 'id="quick-inventory"')}</div>
      </section>
    </div>`,
    'dashboard'
  );
  $('#new-order').onclick = () => orderForm();
  $('#view-orders').onclick = () => navigate('orders');
  $('#quick-client').onclick = () => clientForm();
  $('#quick-inventory').onclick = () => inventoryForm();
  bindOrderActions();
}

function orderTable(orders, actions = true) {
  if (!orders?.length) return empty('No orders yet', 'Create an order to see garments move through your atelier.');
  return `<div class="table-wrap"><table class="table">
    <thead>
      <tr>
        <th>Client</th>
        <th>Garment</th>
        <th>Order Date</th>
        <th>Appointment Status</th>
        <th>Workshop Stage</th>
        ${actions ? '<th></th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${orders.map((order) => {
        const nextStage = state.stages[state.stages.indexOf(order.workshopStage) + 1];
        return `<tr>
          <td><button class="text-button" data-client="${esc(order.clientName)}">${esc(order.clientName)}</button></td>
          <td><strong>${esc(order.garment)}</strong></td>
          <td>${date(order.orderDate || order.createdAt)}</td>
          <td>${apptDisplayBadge(order)}${order.appointment?.date ? `<small class="table-sub">${date(order.appointment.date)}</small>` : ''}</td>
          <td>
            <select class="compact-select" aria-label="Workshop stage for ${esc(order.garment)}" data-stage-select="${esc(order.id)}">
              ${state.stages.map((stage) => `<option value="${esc(stage)}" ${stage === order.workshopStage ? 'selected' : ''}>${esc(stage)}</option>`).join('')}
            </select>
          </td>
          ${actions ? `<td class="row-actions">
            ${nextStage ? button('Move stage', `data-move-stage="${esc(order.id)}"`, 'small') : ''}
            ${button('Edit appointment', `data-edit-appt="${esc(order.id)}"`, 'small')}
            ${button('Edit', `data-edit-order="${esc(order.id)}"`, 'small')}
            ${button('Delete', `data-delete-order="${esc(order.id)}"`, 'small danger ghost')}
          </td>` : ''}
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

function bindOrderActions() {
  document.querySelectorAll('[data-client]').forEach((node) => {
    node.onclick = () => clientProfile(node.dataset.client);
  });
  document.querySelectorAll('[data-edit-order]').forEach((node) => {
    node.onclick = () => orderForm('', node.dataset.editOrder);
  });
  document.querySelectorAll('[data-edit-appt]').forEach((node) => {
    node.onclick = () => appointmentForm(node.dataset.editAppt);
  });
  document.querySelectorAll('[data-move-stage]').forEach((node) => {
    node.onclick = async () => {
      try {
        const { orders } = await api('/api/orders?includeDelivered=true');
        const order = orders.find((item) => item.id === node.dataset.moveStage);
        if (!order) return;
        const next = state.stages[state.stages.indexOf(order.workshopStage) + 1];
        if (!next) return;
        await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ workshopStage: next }) });
        toast(`Moved to ${next}.`);
        await refreshCurrentView();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-stage-select]').forEach((node) => {
    node.onchange = async (event) => {
      try {
        const next = event.target.value;
        await api(`/api/orders/${node.dataset.stageSelect}`, { method: 'PATCH', body: JSON.stringify({ workshopStage: next }) });
        toast(`Stage updated to ${next}.`);
        await refreshCurrentView();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-delete-order]').forEach((node) => {
    node.onclick = async () => {
      if (!(await confirmAction('Delete this order permanently?'))) return;
      try {
        await api(`/api/orders/${node.dataset.deleteOrder}`, { method: 'DELETE' });
        toast('Order deleted.');
        await refreshCurrentView();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-workshop-stage]').forEach((node) => {
    node.onclick = () => {
      state.workshopStageFilter = node.dataset.workshopStage;
      navigate('workshop');
    };
  });
}

async function renderClients() {
  state.activeClient = null;
  const { clients } = await api('/api/clients');
  shell(
    `${header('People & relationships', 'Client profiles', 'A complete profile for contact details, measurements, appointments, materials, and every garment in progress.', button('Add client', 'id="new-client"', 'primary'))}
    <section class="toolbar">
      <input id="client-search" class="search" placeholder="Search clients by name, phone, or email">
      <span class="muted">${clients.length} client${clients.length === 1 ? '' : 's'}</span>
    </section>
    <section class="panel" id="client-list">
      ${clients.length ? `<div class="client-grid">${clients.map((client) => `<article class="client-card">
        <div class="client-card-top">
          <span class="avatar large">${esc(client.name.slice(0, 1).toUpperCase())}</span>
          <div><h3>${esc(client.name)}</h3><p>${esc(client.email || client.phone || 'No contact details')}</p></div>
        </div>
        <div class="client-meta">
          <span>${client.orderCount} order${client.orderCount === 1 ? '' : 's'}</span>
          <span>${Object.values(client.measurements || {}).some((v) => v) ? 'Measurements saved' : 'Measurements empty'}</span>
        </div>
        <div class="card-actions">
          ${button('Open profile', `data-client="${esc(client.name)}"`, 'primary')}
          ${button('Add order', `data-order-client="${esc(client.name)}"`, 'gold')}
          ${button('Edit', `data-edit-client="${esc(client.name)}"`)}
          ${button('Delete', `data-delete-client="${esc(client.name)}"`, 'danger ghost')}
        </div>
      </article>`).join('')}</div>` : empty('Your directory is empty', 'Add your first client to start building the house book.', button('Add first client', 'id="empty-client"', 'primary'))}
    </section>`,
    'clients'
  );
  $('#new-client')?.addEventListener('click', () => clientForm());
  $('#empty-client')?.addEventListener('click', () => clientForm());
  document.querySelectorAll('[data-client]').forEach((node) => { node.onclick = () => clientProfile(node.dataset.client); });
  document.querySelectorAll('[data-order-client]').forEach((node) => { node.onclick = () => orderForm(node.dataset.orderClient); });
  document.querySelectorAll('[data-edit-client]').forEach((node) => { node.onclick = () => clientForm(node.dataset.editClient); });
  document.querySelectorAll('[data-delete-client]').forEach((node) => {
    node.onclick = async () => {
      if (!(await confirmAction(`Delete ${node.dataset.deleteClient}?`))) return;
      try {
        await api(`/api/clients/${encodeURIComponent(node.dataset.deleteClient)}`, { method: 'DELETE' });
        toast('Client deleted.');
        renderClients();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  $('#client-search').oninput = (event) => {
    document.querySelectorAll('.client-card').forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(event.target.value.toLowerCase());
    });
  };
}

function clientForm(name = '', onSave = null) {
  const open = async () => {
    const client = name ? (await api(`/api/clients/${encodeURIComponent(name)}`)).client : {};
    const node = modal(
      name ? 'Edit client' : 'Add client',
      `<form class="form two" id="client-form">
        ${formField('Full name', 'name', client.name || '', 'text', 'required')}
        ${formField('Phone', 'phone', client.phone || '')}
        ${formField('Email', 'email', client.email || '', 'email')}
        <div class="field span-2"><label>Notes</label><textarea name="notes">${esc(client.notes || '')}</textarea></div>
        <div class="field span-2"><label>Care & repair notes</label><textarea name="careNotes">${esc(client.careNotes || '')}</textarea></div>
        <div class="actions span-2">${button('Cancel', 'type="button" data-close')}${button(name ? 'Save changes' : 'Create client', '', 'primary')}</div>
      </form>`
    );
    node.querySelector('[data-close]').onclick = () => node.remove();
    node.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(event.target));
        const res = await api(name ? `/api/clients/${encodeURIComponent(name)}` : '/api/clients', {
          method: name ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        node.remove();
        toast(name ? 'Client updated.' : 'Client added.');
        if (onSave) onSave(res.client);
        else if (state.activeClient) clientProfile(res.client.name);
        else if (state.route === 'measurements') renderMeasurements();
        else if (state.route === 'care') renderCare();
        else renderClients();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  };
  open().catch((error) => toast(error.message, 'error'));
}

async function clientProfile(name) {
  state.route = 'clients';
  state.activeClient = name;
  const { client, orders } = await api(`/api/clients/${encodeURIComponent(name)}`);
  const measurements = Object.entries(client.measurements || {}).filter(([, value]) => value);
  shell(
    `${header('Client profile', client.name, 'Contact, measurements, appointments, materials, and garments in one considered record.', `${button('Back to clients', 'id="back-clients"')}${button('Add order', 'id="profile-order"', 'primary')}`)}
    <div class="profile-layout">
      <section class="panel profile-intro">
        <span class="avatar xl">${esc(client.name.slice(0, 1).toUpperCase())}</span>
        <h2>${esc(client.name)}</h2>
        <p>${esc(client.email || 'No email')}</p>
        <p>${esc(client.phone || 'No phone')}</p>
        <div class="profile-notes">${esc(client.notes || 'No private notes yet.')}</div>
        <div class="profile-notes"><strong>Care & repairs</strong><br>${esc(client.careNotes || 'No care history yet.')}</div>
        ${button('Edit client', 'id="profile-edit"')}
      </section>
      <section class="panel">
        <div class="section-heading"><div><div class="eyebrow">Reusable record</div><h2>Measurements</h2></div>${button('Edit measurements', 'id="edit-measurements"')}</div>
        ${measurements.length ? `<div class="measurement-list">${measurements.map(([key, value]) => `<div><span>${esc(key.replaceAll('_', ' '))}</span><strong>${esc(value)} ${esc(client.measurementUnit || 'in')}</strong></div>`).join('')}</div>` : empty('No measurements yet', 'Capture this client’s fit once and reuse it for every order.')}
      </section>
    </div>
    <section class="panel">
      <div class="section-heading"><div><div class="eyebrow">Work in the house</div><h2>Orders & materials</h2></div>${button('New appointment', 'id="profile-appt"')}</div>
      ${orderTable(orders, true)}
      ${orders.map((order) => `<div class="linked-materials"><strong>${esc(order.garment)} materials:</strong> ${order.materials?.length ? order.materials.map((material) => `${esc(material.name)} (${esc(material.quantity)} ${esc(material.unit)})`).join(', ') : 'None assigned'}<br><strong>Care:</strong> ${esc(order.careInstructions || 'No order-specific instructions.')}</div>`).join('')}
    </section>`,
    'clients'
  );
  $('#back-clients').onclick = () => renderClients();
  $('#profile-order').onclick = () => orderForm(client.name);
  $('#profile-edit').onclick = () => clientForm(client.name, (updated) => clientProfile(updated.name));
  $('#edit-measurements').onclick = () => measurementsForm(client, () => clientProfile(client.name));
  $('#profile-appt').onclick = () => appointmentForm('', client.name);
  bindOrderActions();
}

function measurementsForm(client, onSave = null) {
  const fields = ['Chest', 'Waist', 'Hip', 'Shoulder', 'Sleeve', 'Jacket length', 'Trouser waist', 'Inseam', 'Neck', 'Bicep', 'Wrist', 'Notes'];
  const node = modal(
    `Edit measurements — ${client.name}`,
    `<form class="form two" id="measure-form">
      ${fields.map((field) => {
        const key = field.toLowerCase().replaceAll(' ', '_');
        return formField(field, key, client.measurements?.[key] || '');
      }).join('')}
      <div class="field">
        <label>Unit</label>
        <select name="unit">
          <option value="in" ${client.measurementUnit !== 'cm' ? 'selected' : ''}>inches</option>
          <option value="cm" ${client.measurementUnit === 'cm' ? 'selected' : ''}>centimetres</option>
        </select>
      </div>
      <div class="actions span-2">${button('Cancel', 'type="button" data-close')}${button('Save measurements', '', 'primary')}</div>
    </form>`
  );
  node.querySelector('[data-close]').onclick = () => node.remove();
  node.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target));
    const unit = raw.unit;
    delete raw.unit;
    try {
      await api(`/api/clients/${encodeURIComponent(client.name)}/measurements`, {
        method: 'PATCH',
        body: JSON.stringify({ values: raw, unit })
      });
      node.remove();
      toast('Measurements saved.');
      if (onSave) onSave();
      else if (state.route === 'measurements') renderMeasurements();
      else clientProfile(client.name);
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

async function renderMeasurements() {
  state.activeClient = null;
  const { clients } = await api('/api/clients');
  shell(
    `${header('Fit & form', 'Measurements', 'Open any client’s reusable measurement sheet and keep the fit history close.', button('Add client', 'id="measurement-client"', 'primary'))}
    <section class="panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Client</th><th>Unit</th><th>Saved fields</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            ${clients.length ? clients.map((client) => `<tr>
              <td><button class="text-button" data-client="${esc(client.name)}">${esc(client.name)}</button></td>
              <td>${esc(client.measurementUnit || 'in')}</td>
              <td>${Object.keys(client.measurements || {}).filter((key) => client.measurements[key]).length}</td>
              <td>${date(client.updatedAt)}</td>
              <td class="row-actions">${button('Edit sheet', `data-edit-measurements="${esc(client.name)}"`, 'primary small')}</td>
            </tr>`).join('') : `<tr><td colspan="5">${empty('No clients yet', 'Add a client before recording measurements.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`,
    'measurements'
  );
  $('#measurement-client').onclick = () => clientForm('', () => renderMeasurements());
  document.querySelectorAll('[data-client]').forEach((node) => { node.onclick = () => clientProfile(node.dataset.client); });
  document.querySelectorAll('[data-edit-measurements]').forEach((node) => {
    node.onclick = async () => {
      const { client } = await api(`/api/clients/${encodeURIComponent(node.dataset.editMeasurements)}`);
      measurementsForm(client, () => renderMeasurements());
    };
  });
}

async function renderOrders() {
  state.activeClient = null;
  const { orders } = await api('/api/orders?includeDelivered=true');
  shell(
    `${header('Garments & commissions', 'Orders', 'Every commission from first brief to final presentation.', button('New order', 'id="new-order"', 'primary'))}
    <section class="panel">
      <div class="toolbar">
        <span class="muted" id="order-count">${orders.length} total order${orders.length === 1 ? '' : 's'}</span>
        <div class="toolbar-filters">
          <select id="stage-filter" class="compact-select" aria-label="Filter by workshop stage">
            <option value="all">All workshop stages</option>
            ${state.stages.map((stage) => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('')}
          </select>
          <select id="order-filter" class="compact-select" aria-label="Filter by delivery status">
            <option value="all">All orders</option>
            <option value="active">Active only</option>
            <option value="delivered">Delivered</option>
          </select>
        </div>
      </div>
      <div id="order-list">${orderTable(orders)}</div>
    </section>`,
    'orders'
  );
  $('#new-order').onclick = () => orderForm();
  const applyFilters = () => {
    const statusVal = $('#order-filter').value;
    const stageVal = $('#stage-filter').value;
    const filtered = orders.filter((order) => {
      const statusOk = statusVal === 'active' ? !order.delivered : statusVal === 'delivered' ? order.delivered : true;
      const stageOk = stageVal === 'all' ? true : order.workshopStage === stageVal;
      return statusOk && stageOk;
    });
    $('#order-count').textContent = `${filtered.length} order${filtered.length === 1 ? '' : 's'} shown`;
    $('#order-list').innerHTML = orderTable(filtered);
    bindOrderActions();
  };
  $('#order-filter').onchange = applyFilters;
  $('#stage-filter').onchange = applyFilters;
  bindOrderActions();
}

async function renderInventory() {
  state.activeClient = null;
  const { inventory } = await api('/api/inventory');
  shell(
    `${header('Materials & supply', 'Inventory', 'Know what is in the house before the next commission begins.', button('Add material', 'id="new-inventory"', 'primary'))}
    <section class="inventory-summary">
      <div class="mini-stat"><span>Total materials</span><strong>${inventory.length}</strong></div>
      <div class="mini-stat warning"><span>Reorder soon</span><strong>${inventory.filter((item) => item.reorderAt && item.quantity <= item.reorderAt).length}</strong></div>
    </section>
    <section class="panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Material</th><th>Category</th><th>Quantity</th><th>Supplier</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${inventory.length ? inventory.map((item) => `<tr>
              <td><strong>${esc(item.name)}</strong><small class="table-sub">${esc(item.notes || '')}</small></td>
              <td>${esc(item.category)}</td>
              <td>${esc(item.quantity)} ${esc(item.unit)}</td>
              <td>${esc(item.supplier || '—')}</td>
              <td>${item.reorderAt && item.quantity <= item.reorderAt ? '<span class="badge pending">Reorder</span>' : '<span class="badge completed">In stock</span>'}</td>
              <td class="row-actions">${button('Edit', `data-edit-inventory="${item.id}"`, 'small')}${button('Delete', `data-delete-inventory="${item.id}"`, 'small danger ghost')}</td>
            </tr>`).join('') : `<tr><td colspan="6">${empty('No materials tracked', 'Add fabrics, linings, trims, and other house stock.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`,
    'inventory'
  );
  $('#new-inventory').onclick = () => inventoryForm();
  document.querySelectorAll('[data-edit-inventory]').forEach((node) => { node.onclick = () => inventoryForm(node.dataset.editInventory); });
  document.querySelectorAll('[data-delete-inventory]').forEach((node) => {
    node.onclick = async () => {
      if (!(await confirmAction('Delete this material?'))) return;
      try {
        await api(`/api/inventory/${node.dataset.deleteInventory}`, { method: 'DELETE' });
        toast('Material deleted.');
        renderInventory();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
}

async function inventoryForm(id = '') {
  let item = {};
  if (id) item = (await api('/api/inventory')).inventory.find((candidate) => candidate.id === id) || {};
  const node = modal(
    id ? 'Edit material' : 'Add material',
    `<form class="form two" id="inventory-form">
      ${formField('Material name', 'name', item.name || '', 'text', 'required')}
      ${formField('Category', 'category', item.category || 'Fabric')}
      ${formField('Quantity', 'quantity', item.quantity || 0, 'number', 'min="0" step="0.01" required')}
      ${formField('Unit', 'unit', item.unit || 'm')}
      ${formField('Reorder at', 'reorderAt', item.reorderAt || 0, 'number', 'min="0" step="0.01"')}
      ${formField('Supplier', 'supplier', item.supplier || '')}
      <div class="field span-2"><label>Notes</label><textarea name="notes">${esc(item.notes || '')}</textarea></div>
      <div class="actions span-2">${button('Cancel', 'type="button" data-close')}${button(id ? 'Save material' : 'Add material', '', 'primary')}</div>
    </form>`
  );
  node.querySelector('[data-close]').onclick = () => node.remove();
  node.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(id ? `/api/inventory/${id}` : '/api/inventory', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      node.remove();
      toast(id ? 'Material updated.' : 'Material added.');
      renderInventory();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

async function orderForm(clientName = '', orderId = '') {
  let order = {};
  if (orderId) {
    const result = await api('/api/orders?includeDelivered=true');
    order = result.orders.find((item) => item.id === orderId) || {};
  }
  const { clients } = await api('/api/clients');
  if (!clients.length) {
    toast('Add a client first before creating an order.', 'error');
    clientForm();
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const selectedClientName = order.clientName || clientName || clients[0]?.name || '';
  const adminFields = state.user.role === 'admin'
    ? `${formField('Total amount (₹)', 'totalAmount', order.totalAmount || 0, 'number', 'min="0" step="0.01"')}${formField('Advance paid (₹)', 'advancePaid', order.advancePaid || 0, 'number', 'min="0" step="0.01"')}`
    : '';

  const renderPreviewContent = (cName) => {
    const c = clients.find((item) => item.name === cName);
    const saved = Object.entries(c?.measurements || {}).filter(([, val]) => val);
    if (!saved.length) return '';
    const summary = saved.slice(0, 4).map(([k, v]) => `${esc(k.replaceAll('_', ' '))} ${esc(v)} ${esc(c.measurementUnit || 'in')}`).join(', ');
    return `<div class="measurement-preview">
      <span><strong>Using saved measurements</strong> — ✓ ${summary}${saved.length > 4 ? '…' : ''}</span>
      <button type="button" class="button link" id="preview-edit-measurements">Edit measurements</button>
    </div>`;
  };

  const node = modal(
    orderId ? 'Edit order' : 'New order',
    `<p class="modal-intro">Set the order date, select the client, and describe the garment. Saved client measurements are reused automatically.</p>
    <form class="form two" id="order-form">
      <div class="field"><label>Order date <span class="required">*</span></label><input type="date" name="orderDate" value="${esc(order.orderDate || today)}" required></div>
      <div class="field"><label>Client <span class="required">*</span></label><select name="clientName" id="order-client-select" required>${clients.map((client) => `<option value="${esc(client.name)}" ${client.name === selectedClientName ? 'selected' : ''}>${esc(client.name)}</option>`).join('')}</select></div>
      <div class="span-2" id="measurement-preview-slot">${renderPreviewContent(selectedClientName)}</div>
      <div class="field span-2"><label>Garment / custom description <span class="required">*</span></label><input type="text" name="garment" value="${esc(order.garment || '')}" placeholder="Type anything: navy dinner suit, hand-embroidered sherwani..." required></div>
      <div class="field span-2"><label>Delivery date</label><input type="date" name="deliveryDate" value="${esc(order.deliveryDate || '')}"></div>
      ${adminFields}
      <div class="field span-2"><label>Notes</label><textarea name="notes" placeholder="Construction notes, preferences, or promises">${esc(order.notes || '')}</textarea></div>
      <div class="actions span-2">${button('Cancel', 'type="button" data-close')}${button(orderId ? 'Save order' : 'Create order →', '', 'primary')}</div>
    </form>`
  );

  const wirePreviewLink = () => {
    const btn = node.querySelector('#preview-edit-measurements');
    if (btn) {
      btn.onclick = async () => {
        const currentName = node.querySelector('#order-client-select').value;
        const { client } = await api(`/api/clients/${encodeURIComponent(currentName)}`);
        node.remove();
        measurementsForm(client, () => orderForm(currentName, orderId));
      };
    }
  };
  wirePreviewLink();

  node.querySelector('#order-client-select').onchange = (event) => {
    node.querySelector('#measurement-preview-slot').innerHTML = renderPreviewContent(event.target.value);
    wirePreviewLink();
  };

  node.querySelector('[data-close]').onclick = () => node.remove();
  node.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    try {
      if (orderId) {
        await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
      }
      node.remove();
      toast(orderId ? 'Order updated.' : 'Order created.');
      if (orderId) {
        await refreshCurrentView();
      } else {
        const { client } = await api(`/api/clients/${encodeURIComponent(body.clientName)}`);
        const hasMeasurements = Object.values(client.measurements || {}).some((v) => v);
        if (hasMeasurements) {
          toast(`Using saved measurements for ${client.name}.`);
          navigate('workshop');
        } else {
          measurementsForm(client, () => navigate('workshop'));
        }
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

async function appointmentForm(orderId = '', prefillClient = '') {
  const { orders } = await api('/api/orders?includeDelivered=true');
  const candidateOrders = prefillClient && !orderId
    ? orders.filter((item) => item.clientName === prefillClient)
    : orders;

  if (!candidateOrders.length) {
    toast('Create an order first before scheduling an appointment.', 'error');
    orderForm(prefillClient);
    return;
  }

  const order = orderId
    ? orders.find((item) => item.id === orderId) || candidateOrders[0]
    : candidateOrders[0];
  const appointmentState = order.appointment?.state || 'scheduled';

  const clientFieldHtml = orderId
    ? `<div class="field span-2"><label>Client & Garment</label><input type="text" value="${esc(order.clientName)} — ${esc(order.garment)}" readonly></div>`
    : `<div class="field span-2"><label>Order / Client <span class="required">*</span></label><select name="selectedOrderId" id="appt-order-select" required>${candidateOrders.map((item) => `<option value="${esc(item.id)}" ${item.id === order.id ? 'selected' : ''}>${esc(item.clientName)} — ${esc(item.garment)}</option>`).join('')}</select></div>`;

  const node = modal(
    orderId ? 'Edit appointment' : 'New appointment',
    `<form class="form two" id="appointment-form">
      ${clientFieldHtml}
      <div class="field"><label>Appointment date <span class="required">*</span></label><input type="date" name="appointmentDate" id="appt-date-input" value="${esc(order.appointment?.date || '')}" required></div>
      <div class="field">
        <label>Appointment state</label>
        <select name="appointmentState" id="appt-state-select">
          <option value="scheduled" ${appointmentState === 'scheduled' ? 'selected' : ''}>Scheduled (Upcoming)</option>
          <option value="completed" ${appointmentState === 'completed' ? 'selected' : ''}>Completed (Done)</option>
          <option value="postponed" ${appointmentState === 'postponed' ? 'selected' : ''}>Postponed</option>
        </select>
      </div>
      <div class="actions span-2">${button('Cancel', 'type="button" data-close')}${button('Save appointment', '', 'primary')}</div>
    </form>`
  );

  const selectEl = node.querySelector('#appt-order-select');
  if (selectEl) {
    selectEl.onchange = (event) => {
      const picked = candidateOrders.find((item) => item.id === event.target.value);
      if (picked) {
        node.querySelector('#appt-date-input').value = picked.appointment?.date || '';
        node.querySelector('#appt-state-select').value = picked.appointment?.state || 'scheduled';
      }
    };
  }

  node.querySelector('[data-close]').onclick = () => node.remove();
  node.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.target));
    const targetOrderId = orderId || formData.selectedOrderId;
    try {
      await api(`/api/orders/${targetOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          appointmentDate: formData.appointmentDate,
          appointmentState: formData.appointmentState
        })
      });
      node.remove();
      toast('Appointment saved.');
      await refreshCurrentView();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

async function renderSchedule() {
  state.activeClient = null;
  const { orders } = await api('/api/orders?includeDelivered=true');
  const scheduled = orders
    .filter((order) => order.appointment?.date)
    .sort((a, b) => a.appointment.date.localeCompare(b.appointment.date));

  shell(
    `${header('Fittings & visits', 'Schedule', 'Trials, fittings, and deliveries connected directly to the commission.', button('New appointment', 'id="new-appointment"', 'primary'))}
    <section class="panel">
      <div class="calendar-list">
        ${scheduled.length ? scheduled.map((order) => `<article class="appointment">
          <div class="appointment-date">
            <strong>${new Date(`${order.appointment.date}T12:00:00`).getDate()}</strong>
            <span>${new Date(`${order.appointment.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span>
          </div>
          <div class="appointment-info">
            <h3><button class="text-button" data-client="${esc(order.clientName)}">${esc(order.clientName)}</button></h3>
            <p>${esc(order.garment)} · ${esc(order.workshopStage)}</p>
          </div>
          ${apptDisplayBadge(order)}
          <div class="row-actions">
            ${order.appointment?.state !== 'completed' ? button('Done', `data-complete-appt="${esc(order.id)}"`, 'small primary') : ''}
            ${order.appointment?.state !== 'postponed' ? button('Postponed', `data-postpone-appt="${esc(order.id)}"`, 'small') : ''}
            ${button('Edit', `data-edit-schedule="${esc(order.id)}"`, 'small')}
          </div>
        </article>`).join('') : empty('The calendar is clear', 'Add an appointment to an order and it will appear here.', button('Schedule appointment', 'id="empty-schedule"', 'primary'))}
      </div>
    </section>`,
    'schedule'
  );
  $('#new-appointment').onclick = () => appointmentForm();
  $('#empty-schedule')?.addEventListener('click', () => appointmentForm());
  document.querySelectorAll('[data-client]').forEach((node) => { node.onclick = () => clientProfile(node.dataset.client); });
  document.querySelectorAll('[data-edit-schedule]').forEach((node) => { node.onclick = () => appointmentForm(node.dataset.editSchedule); });
  document.querySelectorAll('[data-complete-appt]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api(`/api/orders/${node.dataset.completeAppt}`, { method: 'PATCH', body: JSON.stringify({ appointmentState: 'completed' }) });
        toast('Appointment marked as Done.');
        renderSchedule();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-postpone-appt]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api(`/api/orders/${node.dataset.postponeAppt}`, { method: 'PATCH', body: JSON.stringify({ appointmentState: 'postponed' }) });
        toast('Appointment marked as Postponed.');
        renderSchedule();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
}

async function renderWorkshop() {
  state.activeClient = null;
  const { orders } = await api('/api/orders?includeDelivered=true');
  const activeStageFilter = state.workshopStageFilter || 'all';
  const visibleStages = activeStageFilter === 'all'
    ? state.stages
    : state.stages.filter((stage) => stage === activeStageFilter);

  const filterControl = `<select id="workshop-stage-filter" class="compact-select" aria-label="Filter workshop board by stage">
    <option value="all" ${activeStageFilter === 'all' ? 'selected' : ''}>All 9 stages</option>
    ${state.stages.map((stage) => `<option value="${esc(stage)}" ${stage === activeStageFilter ? 'selected' : ''}>${esc(stage)}</option>`).join('')}
  </select>${button('New order', 'id="workshop-new-order"', 'primary')}`;

  shell(
    `${header('Craft & progress', 'Workshop', 'Move each garment through the house without losing the client context.', filterControl)}
    <div class="workshop-grid">
      ${visibleStages.map((stage) => {
        const stageIndex = state.stages.indexOf(stage);
        const stageOrders = orders.filter((order) => order.workshopStage === stage);
        return `<section class="workshop-column">
          <div class="column-heading"><h2>${esc(stage)}</h2><span>${stageOrders.length}</span></div>
          ${stageOrders.map((order) => `<article class="work-card">
            <button class="text-button" data-client="${esc(order.clientName)}">${esc(order.clientName)}</button>
            <p><button class="text-button garment-link" data-edit-order="${esc(order.id)}">${esc(order.garment)}</button></p>
            <div class="work-card-actions">
              ${stageIndex > 0 ? button('Move back', `data-retreat="${esc(order.id)}"`, 'small') : ''}
              ${stageIndex < state.stages.length - 1 ? button('Move forward', `data-advance="${esc(order.id)}"`, 'small primary') : ''}
            </div>
          </article>`).join('') || '<div class="column-empty">Clear</div>'}
        </section>`;
      }).join('')}
    </div>`,
    'workshop'
  );

  $('#workshop-new-order').onclick = () => orderForm();
  $('#workshop-stage-filter').onchange = (event) => {
    state.workshopStageFilter = event.target.value;
    renderWorkshop();
  };
  document.querySelectorAll('[data-client]').forEach((node) => { node.onclick = () => clientProfile(node.dataset.client); });
  document.querySelectorAll('[data-edit-order]').forEach((node) => { node.onclick = () => orderForm('', node.dataset.editOrder); });
  document.querySelectorAll('[data-advance]').forEach((node) => {
    node.onclick = async () => {
      const order = orders.find((item) => item.id === node.dataset.advance);
      const next = state.stages[state.stages.indexOf(order.workshopStage) + 1];
      if (next) {
        await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ workshopStage: next }) });
        renderWorkshop();
      }
    };
  });
  document.querySelectorAll('[data-retreat]').forEach((node) => {
    node.onclick = async () => {
      const order = orders.find((item) => item.id === node.dataset.retreat);
      const prev = state.stages[state.stages.indexOf(order.workshopStage) - 1];
      if (prev) {
        await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ workshopStage: prev }) });
        renderWorkshop();
      }
    };
  });
}

function statusTable(orders) {
  if (!orders?.length) return empty('No orders yet', 'Create an order to see house status at a glance.');
  return `<div class="table-wrap"><table class="table">
    <thead>
      <tr>
        <th>Client</th>
        <th>Appointment status</th>
        <th>Workshop status</th>
        <th>Delivered</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${orders.map((order) => `<tr>
        <td><button class="text-button" data-client="${esc(order.clientName)}">${esc(order.clientName)}</button><small class="table-sub">${esc(order.garment)}</small></td>
        <td>${apptDisplayBadge(order)}</td>
        <td><button class="text-button" data-workshop-stage="${esc(order.workshopStage)}"><span class="stage-dot"></span>${esc(order.workshopStage)}</button></td>
        <td>${order.delivered ? '<span class="badge completed">Delivered</span>' : '—'}</td>
        <td class="row-actions">${button('Edit', `data-edit-order="${esc(order.id)}"`, 'small')}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderStatus() {
  state.activeClient = null;
  const { orders } = await api('/api/orders?includeDelivered=true');
  shell(
    `${header('The house at a glance', 'Status quo', 'One clear read of who is waiting, what is moving, and what is complete.', button('New order', 'id="status-new-order"', 'primary'))}
    <section class="panel">${statusTable(orders)}</section>`,
    'status'
  );
  $('#status-new-order').onclick = () => orderForm();
  bindOrderActions();
}

async function renderCare() {
  state.activeClient = null;
  const { clients } = await api('/api/clients');
  const clientsWithCare = clients.filter((client) => String(client.careNotes || '').trim());
  shell(
    `${header('After the handover', 'Care support', 'A quiet, useful guide for keeping a considered garment in good shape.', button('Add client care note', 'id="care-add-client"', 'primary'))}
    <div class="care-grid">
      ${[
        ['Pressing', 'Use a low-temperature steam press and always place a cloth between the iron and the cloth.'],
        ['Storage', 'Give the garment room to breathe on a shaped hanger. Avoid wire hangers and compressed wardrobes.'],
        ['Cleaning', 'Follow the care label and tell the cleaner about hand work, embroidery, and delicate trims.'],
        ['Repairs', 'Log alterations and repairs against the client profile so the house remembers what changed.']
      ].map(([title, copy]) => `<article class="care-card"><div class="eyebrow">HB guide</div><h2>${title}</h2><p>${copy}</p></article>`).join('')}
    </div>
    <section class="panel">
      <div class="section-heading"><div><div class="eyebrow">House records</div><h2>Client care & repair notes</h2></div></div>
      ${clientsWithCare.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Client</th><th>Care & repair history</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          ${clientsWithCare.map((client) => `<tr>
            <td><button class="text-button" data-client="${esc(client.name)}">${esc(client.name)}</button></td>
            <td>${esc(client.careNotes)}</td>
            <td>${date(client.updatedAt)}</td>
            <td class="row-actions">${button('Open profile', `data-client="${esc(client.name)}"`, 'small')}${button('Edit notes', `data-edit-client="${esc(client.name)}"`, 'small')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : empty('No client care notes logged yet', 'Record alterations, pressing notes, or repair history on any client profile and they will appear here.')}
    </section>`,
    'care'
  );
  $('#care-add-client').onclick = () => {
    if (clients.length) clientForm(clients[0].name, () => renderCare());
    else clientForm('', () => renderCare());
  };
  document.querySelectorAll('[data-client]').forEach((node) => { node.onclick = () => clientProfile(node.dataset.client); });
  document.querySelectorAll('[data-edit-client]').forEach((node) => { node.onclick = () => clientForm(node.dataset.editClient, () => renderCare()); });
}

async function navigate(route) {
  state.route = route;
  try {
    if (route === 'dashboard') await renderDashboard();
    else if (route === 'clients') await renderClients();
    else if (route === 'measurements') await renderMeasurements();
    else if (route === 'inventory') await renderInventory();
    else if (route === 'schedule') await renderSchedule();
    else if (route === 'orders') await renderOrders();
    else if (route === 'workshop') await renderWorkshop();
    else if (route === 'status') await renderStatus();
    else if (route === 'care') await renderCare();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function bootstrap() {
  const meta = await api('/api/meta');
  state.stages = meta.workshopStages;
  await navigate('dashboard');
}

state.user = { id: 'local', username: 'HB', role: 'admin' };
bootstrap();
