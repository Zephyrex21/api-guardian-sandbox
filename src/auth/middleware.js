import { verifySession } from "./session.js";
import { config } from "../config.js";

export function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  const user = token ? verifySession(token, config.sessionSecret) : null;

  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  req.user = user;
  next();
}
