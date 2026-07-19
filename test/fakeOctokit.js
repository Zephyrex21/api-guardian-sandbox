/**
 * A minimal fake of the parts of Octokit this project actually uses.
 * Backed by a simple { "ref:path": "file content" } map, so tests can set
 * up exactly the repo state they need without touching the network - the
 * whole point of Phase 2's test suite is to prove the fetch/resolve/format
 * logic is correct in isolation, the same way Phase 1 proved the diff
 * engine was correct in isolation.
 */
export function createFakeOctokit(files = {}) {
  const comments = [];
  const statuses = [];

  return {
    repos: {
      async getContent({ path, ref }) {
        const key = `${ref}:${path}`;
        const content = files[key];
        if (content === undefined) {
          const error = new Error(`Not Found: ${key}`);
          error.status = 404;
          throw error;
        }
        return {
          data: { content: Buffer.from(content, "utf8").toString("base64") },
        };
      },
      async createCommitStatus({ sha, state, description, context }) {
        statuses.push({ sha, state, description, context });
        return { data: { state } };
      },
    },
    issues: {
      async createComment({ body }) {
        comments.push(body);
        return { data: { body } };
      },
    },
    // Not part of the real Octokit shape - exposed so tests can inspect
    // what got posted/set.
    _comments: comments,
    _statuses: statuses,
  };
}
