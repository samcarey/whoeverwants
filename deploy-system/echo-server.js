// Echo Server - the "application" that gets deployed per branch.
//
// Usage: node server.js <branch-name> <port>
//
// Serves a JSON API at any path. Echoes back any query parameters
// concatenated with a space, repeated twice, plus the branch name.
//
// Example: GET /hello?args=foo,bar
//   -> { "branch": "dev", "echo": "foo,bar foo,bar", "result": "foo,bar foo,bar dev" }

const http = require('http');
const url = require('url');

const branch = process.argv[2] || 'unknown';
const port = parseInt(process.argv[3], 10) || 9100;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const query = parsed.query;

  // Collect all query param values into a single string
  const allArgs = Object.values(query).flat().join(' ');
  const echoed = allArgs ? `${allArgs} ${allArgs}` : '';
  const result = echoed ? `${echoed} ${branch}` : branch;

  const response = {
    branch,
    path: parsed.pathname,
    args: query,
    echo: echoed,
    result
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response, null, 2));
});

server.listen(port, () => {
  console.log(`Echo server for branch "${branch}" listening on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
