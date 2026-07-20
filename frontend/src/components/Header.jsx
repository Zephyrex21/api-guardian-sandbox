import { api } from "../api.js";

export function Header({ user }) {
  return (
    <header className="header">
      <h1 className="wordmark">
        API <span>Guardian</span>
      </h1>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        <div className="watch-indicator">
          <span className="watch-dot" />
          Watching
        </div>
        {user && (
          <div className="user-chip">
            <img src={user.avatarUrl} alt="" />
            {user.login}
            <a className="logout-link" href={api.logoutUrl()}>
              Sign out
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
