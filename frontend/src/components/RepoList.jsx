import { formatRelativeTime } from "../utils.js";

export function RepoList({ repos }) {
  if (repos.length === 0) {
    return (
      <div className="empty-state">
        <strong>No repositories yet</strong>
        Once you install the GitHub App on a repo and open a PR that touches its OpenAPI spec, it'll show up here.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {repos.map((r) => (
        <li className="repo-item" key={`${r.owner}/${r.repo}`}>
          <div className="repo-name">
            <span className="repo-owner">{r.owner}/</span>
            {r.repo}
          </div>
          <div className="repo-checked">checked {formatRelativeTime(r.lastCheckedAt)}</div>
        </li>
      ))}
    </ul>
  );
}
