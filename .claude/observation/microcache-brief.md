Build "Microcache": a tiny in-process LRU cache library for Node.js.

Core requirements:
- get(key), set(key, value, ttlMs?), delete(key), has(key), clear()
- Bounded by a max entry count (constructor option), evicts least-recently-used
  when full
- Optional per-entry TTL; an expired entry is treated as absent on read and is
  swept lazily (no background timers)
- Zero runtime dependencies, Node >= 18, ESM
- node:test suite: success, failure, and edge cases per function (empty cache,
  single entry, eviction at exactly the boundary, TTL expiry, TTL of 0)

Out of scope: persistence, multi-process/shared-memory caching, an LRU-K variant,
any network interface. This is a library, not a service.
