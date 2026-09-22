# Spanning Tree Board

A full-stack web app for the Minimum Spanning Tree (MST) problem. Draw a
weighted graph by hand on an interactive board, then have the Node.js
backend compute the minimum spanning tree with Kruskal's or Prim's
algorithm and replay it step by step.

## Features

- **Manual graph drawing** — click to place nodes, connect them into
  weighted edges, drag to reposition, erase, all on an SVG canvas.
- **Two algorithms** — Kruskal (sort edges, skip cycles) and Prim (grow a
  tree from a chosen start node), both implemented from scratch in
  `lib/mst.js` with no external graph library.
- **Step replay** — scrub through or auto-play every accept/reject
  decision the algorithm made, highlighted on the board.
- **Disconnected graphs** — handled correctly as a minimum spanning
  *forest*, reported as such.
- **Save / load** — graphs persist server-side to a JSON file via a small
  REST API, so you can reload a layout later.
- **No build step, no framework** — plain HTML/CSS/JS on the front end,
  the Node.js standard library (`http`) on the back end.

## Run it

```bash
npm start       # serves the app at http://localhost:3000
npm test        # unit tests (algorithms) + integration tests (API)
```

## API

| Method | Path              | Purpose                                   |
|--------|-------------------|--------------------------------------------|
| POST   | `/api/mst`        | Compute an MST for a submitted graph       |
| GET    | `/api/graphs`      | List saved graphs                          |
| POST   | `/api/graphs`      | Save a graph                               |
| GET    | `/api/graphs/:id`  | Load one saved graph                       |
| DELETE | `/api/graphs/:id`  | Delete a saved graph                       |

## Project layout

```
server.js        HTTP server + REST API + static file serving
lib/mst.js        Kruskal & Prim implementations, graph validation
public/           Front end: index.html, app.js, style.css
test/             node:test unit + integration tests
data/graphs.json  Created automatically to store saved graphs
```
