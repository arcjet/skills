import express from "express";
import aj, { detectBot, slidingWindow } from "../lib/arcjet";

const app = express();
app.use(express.json());

const protectedAj = aj
  .withRule(
    detectBot({
      mode: "LIVE",
      allow: [
        "CATEGORY:SEARCH_ENGINE",
        "CATEGORY:MONITOR",
        "CATEGORY:PREVIEW",
      ],
    }),
  )
  .withRule(
    slidingWindow({
      mode: "LIVE",
      interval: 60,
      max: 100,
    }),
  );

app.get("/api/data", async (req, res) => {
  const decision = await protectedAj.protect(req);

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    if (decision.reason.isBot() || decision.reason.isShield() || decision.reason.isFilterRule()) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (decision.isErrored()) {
    console.warn("Arcjet error:", decision.reason.message);
  }

  res.json({ items: [{ id: 1, name: "Widget" }] });
});

app.listen(3000);
