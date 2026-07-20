import { api } from "../api.js";

export function LoginScreen() {
  return (
    <div className="login-screen">
      <h1 className="wordmark">
        API <span>Guardian</span>
      </h1>
      <p className="login-tagline">
        Sign in to see every breaking API change your repos have caught, and which ones are still waiting on you.
      </p>
      <a className="login-button" href={api.loginUrl()}>
        Sign in with GitHub
      </a>
    </div>
  );
}
