/**
 * A minimal fake of the parts of a MongoDB Collection this project
 * actually uses (findOne, updateOne with upsert). Backed by a plain array,
 * so tests can verify acknowledgment persistence without a real MongoDB
 * connection - same philosophy as fakeOctokit.js.
 */
export function createFakeCollection() {
  const docs = [];

  function matches(doc, query = {}) {
    return Object.keys(query).every((key) => doc[key] === query[key]);
  }

  function makeCursor(results) {
    let sorted = [...results];
    let limited = null;
    const cursor = {
      sort(sortSpec) {
        const [[key, direction]] = Object.entries(sortSpec);
        sorted = [...sorted].sort((a, b) => (a[key] > b[key] ? 1 : -1) * direction);
        return cursor;
      },
      limit(n) {
        limited = n;
        return cursor;
      },
      async toArray() {
        return limited != null ? sorted.slice(0, limited) : sorted;
      },
    };
    return cursor;
  }

  return {
    async findOne(query) {
      return docs.find((doc) => matches(doc, query)) || null;
    },
    async updateOne(query, update, options = {}) {
      const existingIndex = docs.findIndex((doc) => matches(doc, query));
      if (existingIndex >= 0) {
        docs[existingIndex] = { ...docs[existingIndex], ...update.$set };
      } else if (options.upsert) {
        docs.push({ ...update.$set });
      }
    },
    async insertOne(doc) {
      docs.push({ ...doc });
    },
    find(query) {
      return makeCursor(docs.filter((doc) => matches(doc, query)));
    },
    async countDocuments(query) {
      return docs.filter((doc) => matches(doc, query)).length;
    },
    // Not part of the real Collection shape - exposed for test assertions.
    _docs: docs,
  };
}
