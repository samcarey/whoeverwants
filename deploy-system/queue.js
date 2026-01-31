// File-based queue: each item is a JSON file in the queue/ directory.
// Files are named with a timestamp so they sort chronologically.

const fs = require('fs');
const path = require('path');

const QUEUE_DIR = path.join(__dirname, 'queue');

function ensureDir() {
  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function enqueue(data) {
  ensureDir();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(QUEUE_DIR, name);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return name;
}

function dequeue() {
  ensureDir();
  const files = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort(); // chronological since names start with timestamp

  if (files.length === 0) return null;

  const filepath = path.join(QUEUE_DIR, files[0]);
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  fs.unlinkSync(filepath);
  return data;
}

function peek() {
  ensureDir();
  const files = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  return files.length;
}

module.exports = { enqueue, dequeue, peek };
