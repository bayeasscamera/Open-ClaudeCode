// Rate limiter — sliding window, 100 req/s, localhost-only bridge.
// Tracks request timestamps in a circular buffer; rejects with 429 when exceeded.

const MAX_REQUESTS_PER_SECOND = 100;
const WINDOW_MS = 1000;

function createRateLimiter({ maxRequests = MAX_REQUESTS_PER_SECOND, windowMs = WINDOW_MS } = {}) {
  const timestamps = new Array(maxRequests).fill(0);
  let writeIndex = 0;
  let count = 0;

  function allow() {
    const now = Date.now();
    const cutoff = now - windowMs;

    while (count > 0 && timestamps[(writeIndex - count + maxRequests) % maxRequests] <= cutoff) {
      count--;
    }

    if (count >= maxRequests) {
      return false;
    }

    timestamps[writeIndex] = now;
    writeIndex = (writeIndex + 1) % maxRequests;
    count++;
    return true;
  }

  function reset() {
    timestamps.fill(0);
    writeIndex = 0;
    count = 0;
  }

  return { allow, reset };
}

function sendRateLimited(res) {
  res.writeHead(429, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Too many requests. Please slow down.' } }));
}

module.exports = { createRateLimiter, sendRateLimited, MAX_REQUESTS_PER_SECOND, WINDOW_MS };
