import jwt from "jsonwebtoken";

const SESSION_LIFETIME = "30d";

/** payload is whatever you want to remember about the logged-in user - here, just their GitHub login and id. */
export function signSession(payload, secret) {
  return jwt.sign(payload, secret, { expiresIn: SESSION_LIFETIME });
}

/** Returns the decoded payload if the token is valid and unexpired, or null otherwise - never throws, so callers don't need a try/catch at every call site. */
export function verifySession(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}
