import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

// Spin up a real server against an empty (but valid) claude dir and assert the
// PWA static assets serve 200 with the expected MIME types, and that /api/*
// stays uncached/network-only behavior is irrelevant here (server side).
function emptyClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-pwa-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) => {
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
      });
      req.on('error', reject);
      req.end();
    });
  });
}

test('PWA shell assets serve 200 with correct MIME types', async () => {
  const dir = emptyClaudeDir();
  const { server } = await createServer(dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const sw = await get(port, '/sw.js');
    assert.equal(sw.status, 200, '/sw.js should serve 200');
    assert.match(sw.type, /text\/javascript/, '/sw.js should be javascript');

    const man = await get(port, '/manifest.webmanifest');
    assert.equal(man.status, 200, '/manifest.webmanifest should serve 200');
    assert.match(man.type, /application\/manifest\+json/, 'manifest MIME');
    const parsed = JSON.parse(man.body);
    assert.equal(parsed.name, 'ClaudeScope');
    assert.equal(parsed.display, 'standalone');

    const widget = await get(port, '/widget.html');
    assert.equal(widget.status, 200, '/widget.html should serve 200');
    assert.match(widget.type, /text\/html/, 'widget MIME');

    const icon = await get(port, '/icon.svg');
    assert.equal(icon.status, 200, '/icon.svg should serve 200');
    assert.match(icon.type, /image\/svg\+xml/, 'icon MIME');

    // The raster PWA icons required for install must exist and serve image/png.
    for (const p of ['/icon-192.png', '/icon-512.png']) {
      const png = await get(port, p);
      assert.equal(png.status, 200, `${p} should serve 200`);
      assert.match(png.type, /image\/png/, `${p} MIME`);
    }

    // index.html wires up the manifest + sw registration.
    const index = await get(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.body, /rel="manifest"/);
    assert.match(index.body, /serviceWorker/);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a genuinely missing static asset 404s cleanly', async () => {
  const dir = emptyClaudeDir();
  const { server } = await createServer(dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const missing = await get(port, '/does-not-exist.png');
    assert.equal(missing.status, 404, 'missing asset 404s cleanly');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
