# Tessera

Split a 3D model into parts that fit your printer, joined with connectors so you
can print the pieces separately and assemble them back into the whole. Runs
entirely in your browser — your files never leave your machine.

> Named after mosaic tiles: separate pieces that recompose into a whole.

## What it does

- Load a model (STL, OBJ or 3MF).
- Enter your printer's build volume, or pick a preset.
- Tessera splits the model into parts that fit and adds connectors (alignment
  pins, heat-set inserts, magnets or dovetails) so the pieces line up and join.
- Preview the split, then export the parts ready to print.
- Optional AI assistant: describe what you want in plain language and it sets
  the split up for you.

## Run it

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Then open the local address it prints in your browser.

## License

[MIT](LICENSE) © 2026 The Tessera authors.
