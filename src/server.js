import express from "express";
import { config } from "./config.js";
import { webhooks } from "./webhooks.js";

const app = express();

// Health check - useful for Render's health monitoring and for confirming
// a fresh deploy is actually up before wiring the real GitHub webhook URL.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// IMPORTANT: signature verification needs the *raw* request body bytes,
// not JSON already parsed by a body-parser - the HMAC is computed over the
// exact bytes GitHub sent. So this route uses express.raw() instead of
// express.json(), and only on this one route.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const id = req.headers["x-github-delivery"];
    const name = req.headers["x-github-event"];
    const signature = req.headers["x-hub-signature-256"];

    if (!id || !name || !signature) {
      console.warn("[webhook] rejected: missing required GitHub headers");
      return res.status(400).send("Missing required GitHub webhook headers");
    }

    try {
      // verifyAndReceive rejects (throws) if the signature doesn't match -
      // nothing below this line runs on a request that isn't really from
      // GitHub.
      await webhooks.verifyAndReceive({
        id,
        name,
        signature,
        payload: req.body.toString("utf8"),
      });

      // Acknowledge quickly. GitHub considers a delivery failed (and will
      // retry) if it doesn't get a 2xx response promptly - our actual work
      // already happened in the handler above before we reply here, which
      // is fine for Phase 0's single lightweight action but will need
      // rethinking once Phase 3's AI call could take several seconds.
      res.status(200).send("ok");
    } catch (error) {
      console.error(`[webhook] verification/handling failed: ${error.message}`);
      res.status(401).send("Webhook signature verification failed");
    }
  }
);

app.listen(config.port, () => {
  console.log(`API Guardian listening on port ${config.port}`);
});
