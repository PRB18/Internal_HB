'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appointmentStatus, publicOrder } = require('../server/index');

test('scheduled appointment becomes pending after its date', () => {
  assert.equal(appointmentStatus({ state: 'scheduled', date: '2020-01-01' }), 'pending');
});

test('future scheduled appointment remains scheduled', () => {
  assert.equal(appointmentStatus({ state: 'scheduled', date: '2099-01-01' }), 'scheduled');
});

test('explicit appointment states take precedence over date', () => {
  assert.equal(appointmentStatus({ state: 'completed', date: '2099-01-01' }), 'completed');
  assert.equal(appointmentStatus({ state: 'postponed', date: '2020-01-01' }), 'postponed');
});

test('invalid appointment dates do not become pending', () => {
  assert.equal(appointmentStatus({ state: 'scheduled', date: 'not-a-date' }), 'scheduled');
});

test('staff order projection excludes financial fields', () => {
  const order = publicOrder({ id: '1', totalAmount: 100, advancePaid: 50, appointment: null }, 'staff');
  assert.equal('totalAmount' in order, false);
  assert.equal('advancePaid' in order, false);
});

test('admin order projection retains financial fields', () => {
  const order = publicOrder({ id: '1', totalAmount: 100, advancePaid: 50, appointment: null }, 'admin');
  assert.equal(order.totalAmount, 100);
  assert.equal(order.advancePaid, 50);
});
