'use strict';

/**
 * In-memory persistence engine for PostureGuard.
 * Provides fallback persistence for sessions, events, and settings when
 * MongoDB is not running, and serves as deterministic storage for tests.
 */

function toComparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matches(doc, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && expected.$ne !== undefined) {
      return toComparable(doc[key]) !== expected.$ne;
    }
    return toComparable(doc[key]) === expected;
  });
}

function compareBySpec(a, b, spec) {
  if (!spec) return 0;
  for (const [key, direction] of Object.entries(spec)) {
    const av = toComparable(a[key]);
    const bv = toComparable(b[key]);
    if (av === bv) continue;
    const cmp = av < bv ? -1 : 1;
    return cmp * (direction < 0 ? -1 : 1);
  }
  return 0;
}

class InMemoryCollection {
  constructor(name) {
    this.name = name;
    this.docs = [];
  }

  async insertOne(doc) {
    this.docs.push(doc);
    return { acknowledged: true, insertedId: doc._id ?? null };
  }

  async findOne(filter = {}, opts = {}) {
    const found = this.docs.filter((doc) => matches(doc, filter));
    found.sort((a, b) => compareBySpec(a, b, opts.sort));
    return found[0] ?? null;
  }

  find(filter = {}) {
    const source = this.docs;
    const state = { filter, sort: null, limit: null };
    return {
      sort(spec) {
        state.sort = spec;
        return this;
      },
      limit(n) {
        state.limit = n;
        return this;
      },
      async toArray() {
        let docs = source.filter((doc) => matches(doc, state.filter));
        docs.sort((a, b) => compareBySpec(a, b, state.sort));
        if (state.limit !== null) {
          docs = docs.slice(0, state.limit);
        }
        return docs;
      },
    };
  }

  async findOneAndUpdate(filter, update, opts = {}) {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) {
      if (opts.upsert) {
        const created = { ...filter, ...(update.$set || {}) };
        this.docs.push(created);
        return created;
      }
      return null;
    }
    const updated = { ...this.docs[index], ...(update.$set || {}) };
    this.docs[index] = updated;
    return updated;
  }

  async deleteMany() {
    this.docs = [];
    return { acknowledged: true, deletedCount: 0 };
  }

  async aggregate(pipeline) {
    let docs = this.docs.slice();
    for (const stage of pipeline) {
      if (stage.$match) {
        docs = docs.filter((doc) => matches(doc, stage.$match));
      } else if (stage.$group) {
        const groupSpec = stage.$group;
        const keyExpr = groupSpec._id;
        const buckets = new Map();
        for (const doc of docs) {
          const key = typeof keyExpr === 'string' && keyExpr.startsWith('$')
            ? doc[keyExpr.slice(1)]
            : keyExpr;
          if (!buckets.has(key)) {
            buckets.set(key, []);
          }
          buckets.get(key).push(doc);
        }
        docs = [...buckets.entries()].map(([key, list]) => {
          const row = { _id: key };
          for (const [field, expr] of Object.entries(groupSpec)) {
            if (field === '_id') continue;
            if (expr && typeof expr === 'object' && expr.$sum === 1) {
              row[field] = list.length;
            }
          }
          return row;
        });
      }
    }
    return { toArray: async () => docs };
  }
}

function createInMemoryPersistence() {
  const collections = new Map();
  return {
    async status() {
      return { connected: true };
    },
    getDb() {
      return {
        collection(name) {
          if (!collections.has(name)) {
            collections.set(name, new InMemoryCollection(name));
          }
          return collections.get(name);
        },
      };
    },
    async disconnect() {
      collections.clear();
    },
  };
}

module.exports = { createInMemoryPersistence, InMemoryCollection };
