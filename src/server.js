import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAll } from './parser.js';
import { buildAnalytics, search } from './analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
}

export async function createServer(claudeDir, { onLog } = {}) {
  const log = onLog || (() => {});
  log('Scanning transcripts…');
  const t0 = Date.now();
  const { sessions, messages } = await parseAll(claudeDir);
  const analytics = buildAnalytics(sessions);
  log(`Parsed ${sessions.length} sessions, ${messages.length} messages in ${Date.now() - t0}ms`);

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/api/analytics')) {
      return send(res, 200, JSON.stringify(analytics));
    }
    if (url.startsWith('/api/search')) {
      const u = new URL(url, 'http://localhost');
      const q = u.searchParams.get('q') || '';
      return send(res, 200, JSON.stringify(search(messages, q)));
    }
    if (url.startsWith('/api/meta')) {
      return send(res, 200, JSON.stringify({ claudeDir, sessions: sessions.length, messages: messages.length }));
    }
    return serveStatic(res, url);
  });

  return { server, analytics, sessions, messages };
}
