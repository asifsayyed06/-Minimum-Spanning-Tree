'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { ALGORITHMS, validateGraph, computeMst } = require('./lib/mst');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(httpError(413, 'Request body is too large'));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(httpError(400, 'Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Picks only the fields we store, so saved files stay small and predictable. */
function cleanSavedGraph(body) {
  const problem = validateGraph(body.nodes, body.edges);
  if (problem) throw httpError(400, problem);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 60) {
    throw httpError(400, 'A graph name must be 1 to 60 characters');
  }

  const nodes = body.nodes.map((node) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw httpError(400, `Node "${node.id}" needs numeric x and y positions`);
    }
    const label = typeof node.label === 'string' ? node.label.slice(0, 20) : node.id;
    return { id: node.id, label, x: Math.round(node.x), y: Math.round(node.y) };
  });
  const edges = body.edges.map(({ id, from, to, weight }) => ({ id, from, to, weight }));
  return { name, nodes, edges };
}

function createServer({ dataFile = path.join(__dirname, 'data', 'graphs.json') } = {}) {
  function loadGraphs() {
    try {
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch {
      return [];
    }
  }

  function storeGraphs(list) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const temp = `${dataFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(list, null, 2));
    fs.renameSync(temp, dataFile); // swap in whole file so a crash never leaves half a write
  }

  async function handleApi(req, res, pathname) {
    // POST /api/mst  -> compute a minimum spanning tree
    if (pathname === '/api/mst') {
      if (req.method !== 'POST') throw httpError(405, 'Use POST for /api/mst');
      const body = await readJson(req);
      const problem = validateGraph(body.nodes, body.edges);
      if (problem) throw httpError(400, problem);

      const algorithm = body.algorithm === undefined ? 'kruskal' : body.algorithm;
      if (!ALGORITHMS.includes(algorithm)) {
        throw httpError(400, `algorithm must be one of: ${ALGORITHMS.join(', ')}`);
      }
      const start = typeof body.start === 'string' ? body.start : '';
      if (start && !body.nodes.some((node) => node.id === start)) {
        throw httpError(400, 'start must be the id of a node in the graph');
      }
      return sendJson(res, 200, computeMst(body.nodes, body.edges, algorithm, start));
    }

    // /api/graphs  -> list or save
    if (pathname === '/api/graphs') {
      if (req.method === 'GET') {
        const summaries = loadGraphs()
          .map((g) => ({
            id: g.id,
            name: g.name,
            savedAt: g.savedAt,
            nodeCount: g.nodes.length,
            edgeCount: g.edges.length,
          }))
          .reverse();
        return sendJson(res, 200, summaries);
      }
      if (req.method === 'POST') {
        const graph = { id: randomUUID(), ...cleanSavedGraph(await readJson(req)), savedAt: new Date().toISOString() };
        const list = loadGraphs();
        if (list.length >= 100) throw httpError(409, 'Saved graph limit reached. Delete one first.');
        list.push(graph);
        storeGraphs(list);
        return sendJson(res, 201, graph);
      }
      throw httpError(405, 'Use GET or POST for /api/graphs');
    }

    // /api/graphs/:id  -> load or delete
    const match = pathname.match(/^\/api\/graphs\/([0-9a-f-]{36})$/);
    if (match) {
      const list = loadGraphs();
      const index = list.findIndex((g) => g.id === match[1]);
      if (index === -1) throw httpError(404, 'That saved graph no longer exists');

      if (req.method === 'GET') return sendJson(res, 200, list[index]);
      if (req.method === 'DELETE') {
        list.splice(index, 1);
        storeGraphs(list);
        res.writeHead(204);
        return res.end();
      }
      throw httpError(405, 'Use GET or DELETE for a saved graph');
    }

    throw httpError(404, 'No such API route');
  }

  function serveStatic(res, pathname) {
    let relative;
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      throw httpError(400, 'Bad URL');
    }
    const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw httpError(403, 'Forbidden');

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      });
      res.end(content);
    });
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed');
      return serveStatic(res, pathname);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error(error);
      if (res.headersSent) return res.end();
      sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server' : error.message });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`Spanning tree board running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
