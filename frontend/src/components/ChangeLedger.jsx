import { formatRelativeTime, shortSha } from "../utils.js";

export function ChangeLedger({ changes }) {
  if (changes.length === 0) {
    return (
      <div className="empty-state">
        <strong>The log is empty</strong>
        Nothing has been reviewed yet. Open a pull request that changes a tracked OpenAPI spec, and it'll appear here within seconds.
      </div>
    );
  }

  return (
    <div>
      {changes.map((c) => (
        <div className="change-entry" key={`${c.owner}/${c.repo}/${c.sha}`}>
          <span className={`change-tag ${c.breakingCount > 0 ? "breaking" : "clean"}`}>
            {c.breakingCount > 0 ? "Breaking" : "Clean"}
          </span>
          <div className="change-detail">
            <div className="change-repo">
              {c.owner}/{c.repo} <span className="pr">#{c.prNumber}</span>
            </div>
            <div className="change-meta">
              {shortSha(c.sha)} · {c.specPath} · {c.breakingCount} breaking, {c.nonBreakingCount} safe
            </div>
          </div>
          <div className={`change-status ${c.acknowledged ? "sealed" : "open"}`}>
            {c.breakingCount === 0 ? formatRelativeTime(c.createdAt) : c.acknowledged ? "Acknowledged" : "Unacknowledged"}
          </div>
        </div>
      ))}
    </div>
  );
}
