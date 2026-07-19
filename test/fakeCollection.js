/**
 * A minimal fake of the parts of a MongoDB Collection this project
 * actually uses (findOne, updateOne with upsert). Backed by a plain array,
 * so tests can verify acknowledgment persistence without a real MongoDB
 * connection - same philosophy as fakeOctokit.js.
 */
export function createFakeCollection() {
  const docs = [];

  function matches(doc, query) {
    return Object.keys(query).every((key) => doc[key] === query[key]);
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
    // Not part of the real Collection shape - exposed for test assertions.
    _docs: docs,
  };
}
