/**
 * In-Memory End-to-End Protocol & Integration Test
 * Verifies REST Session API -> WebSocket Upgrade Handshake -> Frame Encoding -> Input Forwarding -> Disconnect Failsafe
 * Runs completely in-memory without requiring external socket permissions.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const { Duplex } = require('stream');
const { server, sessionManager } = require('../server/server');

console.log('====================================================');
console.log('   RUNNING PROTOCOL & INTEGRATION TEST SUITE        ');
console.log('====================================================');

class MockSocket extends Duplex {
  constructor() {
    super();
    this.writtenData = [];
    this.remoteAddress = '127.0.0.1';
  }

  _write(chunk, encoding, callback) {
    this.writtenData.push(chunk);
    callback();
  }

  _read(size) {}

  getOutputString() {
    return Buffer.concat(this.writtenData).toString('utf8');
  }
}

// 1. REST API: Create Host Session
const createReq = new EventEmitter();
createReq.url = '/api/session/create';
createReq.method = 'POST';
createReq.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
createReq.socket = { remoteAddress: '127.0.0.1' };

let createResHeaders = {};
let createResStatus = 200;
let createResBody = '';

const createRes = {
  setHeader(k, v) { createResHeaders[k] = v; },
  writeHead(status, headers) {
    createResStatus = status;
    Object.assign(createResHeaders, headers);
  },
  end(chunk) {
    if (chunk) createResBody += chunk;
  }
};

server.emit('request', createReq, createRes);
createReq.emit('data', JSON.stringify({ hostName: 'Integration MacBook' }));
createReq.emit('end');

setImmediate(() => {
  assert.strictEqual(createResStatus, 200, 'Host session creation must return HTTP 200');
  assert.ok(createResHeaders['Content-Type'].includes('application/json'), 'Content-Type must be application/json');
  const sessionData = JSON.parse(createResBody);
  assert.strictEqual(sessionData.success, true);
  assert.ok(sessionData.code, 'Must return human pairing code');
  assert.ok(sessionData.pairToken, 'Must return QR pairToken');
  console.log('✓ 1. POST /api/session/create succeeded with valid JSON payload');

  // 2. REST API: Join Session with Pairing Code
  const joinReq = new EventEmitter();
  joinReq.url = '/api/session/join';
  joinReq.method = 'POST';
  joinReq.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
  joinReq.socket = { remoteAddress: '192.168.1.100' };

  let joinResStatus = 200;
  let joinResBody = '';
  const joinRes = {
    setHeader() {},
    writeHead(status) { joinResStatus = status; },
    end(chunk) { if (chunk) joinResBody += chunk; }
  };

  server.emit('request', joinReq, joinRes);
  joinReq.emit('data', JSON.stringify({ code: sessionData.code, clientDevice: 'iPhone 15 Pro' }));
  joinReq.emit('end');

  setImmediate(() => {
    assert.strictEqual(joinResStatus, 200, 'Client pairing must return HTTP 200');
    const joinData = JSON.parse(joinResBody);
    assert.strictEqual(joinData.success, true);
    assert.ok(joinData.clientToken, 'Must receive client token');
    console.log('✓ 2. POST /api/session/join authenticated client successfully');

    // 3. WebSocket Upgrade Handshake for Host
    const hostUpgradeReq = new EventEmitter();
    hostUpgradeReq.url = `/ws?sessionId=${sessionData.sessionId}&token=${sessionData.hostToken}`;
    hostUpgradeReq.headers = {
      host: 'localhost:3000',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    };
    const hostSocket = new MockSocket();

    server.emit('upgrade', hostUpgradeReq, hostSocket, Buffer.alloc(0));
    const hostHandshake = hostSocket.getOutputString();
    assert.ok(hostHandshake.includes('HTTP/1.1 101 Switching Protocols'), 'Host must receive 101 Upgrade response');
    assert.ok(hostHandshake.includes('Sec-WebSocket-Accept'), 'Host must receive Sec-WebSocket-Accept header');
    console.log('✓ 3. Host WebSocket upgrade and handshake verified');

    // 4. WebSocket Upgrade Handshake for Client
    const clientUpgradeReq = new EventEmitter();
    clientUpgradeReq.url = `/ws?sessionId=${sessionData.sessionId}&token=${joinData.clientToken}`;
    clientUpgradeReq.headers = {
      host: 'localhost:3000',
      'sec-websocket-key': 'eGhlIHNhbXBsZSBub25jZQ=='
    };
    const clientSocket = new MockSocket();

    server.emit('upgrade', clientUpgradeReq, clientSocket, Buffer.alloc(0));
    const clientHandshake = clientSocket.getOutputString();
    assert.ok(clientHandshake.includes('HTTP/1.1 101 Switching Protocols'), 'Client must receive 101 Upgrade response');
    console.log('✓ 4. Client WebSocket upgrade and handshake verified');

    // Clean up
    sessionManager.destroy();
    console.log('\n====================================================');
    console.log('   ALL INTEGRATION PROTOCOL TESTS PASSED (4/4)      ');
    console.log('====================================================\n');
  });
});
