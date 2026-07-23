import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Header } from "./components/Header.jsx";
import { StatRow } from "./components/StatRow.jsx";
import { RepoList } from "./components/RepoList.jsx";
import { ChangeLedger } from "./components/ChangeLedger.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";

export default function App() {
  const [status, setStatus] = useState("loading"); // "loading" | "loggedOut" | "ready" | "error"
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [repos, setRepos] = useState([]);
  const [changes, setChanges] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me);

        const [statsData, reposData, changesData] = await Promise.all([
          api.stats(),
          api.repos(),
          api.changes(),
        ]);
        if (cancelled) return;

        setStats(statsData);
        setRepos(reposData);
        setChanges(changesData);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        if (error.unauthorized) {
          setStatus("loggedOut");
        } else {
          console.error(error);
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return <div className="login-screen" aria-live="polite" />;
  }

  if (status === "loggedOut") {
    return <LoginScreen />;
  }

  if (status === "error") {
    return (
      <div className="login-screen">
        <h1 className="wordmark">
          API <span>Guardian</span>
        </h1>
        <p className="login-tagline">
          Couldn't reach the API. Check that the backend is running and VITE_API_URL points at it.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header user={user} />
      <StatRow stats={stats} />
      <main className="main">
        <div className="panel clay">
          <h2 className="panel-title">Repositories under watch</h2>
          <RepoList repos={repos} />
        </div>
        <div className="panel clay">
          <h2 className="panel-title">Recent activity</h2>
          <ChangeLedger changes={changes} />
        </div>
      </main>
    </div>
  );
}
