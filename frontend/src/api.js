const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function get(path) {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (response.status === 401) {
    const error = new Error("Not logged in");
    error.unauthorized = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  me: () => get("/api/me"),
  stats: () => get("/api/stats"),
  changes: () => get("/api/changes"),
  repos: () => get("/api/repos"),
  loginUrl: () => `${API_URL}/auth/github`,
  logoutUrl: () => `${API_URL}/auth/logout`,
};
