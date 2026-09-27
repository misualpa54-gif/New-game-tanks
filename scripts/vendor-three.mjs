// Copies three.js from node_modules into ./vendor/three so the game can run
// fully offline (the "local" provider in src/cdn.js). Run: npm i && npm run vendor
import { cp, mkdir } from 'node:fs/promises';
const src = 'node_modules/three';
await mkdir('vendor/three', { recursive: true });
await cp(`${src}/build`, 'vendor/three/build', { recursive: true });
await cp(`${src}/examples/jsm`, 'vendor/three/examples/jsm', { recursive: true });
console.log('three.js copied to ./vendor/three — open index.html?cdn=local');
