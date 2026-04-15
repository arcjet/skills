import arcjet, { tokenBucket, detectBot } from "@arcjet/node";
import express from "express";

const app = express();
app.use(express.json());

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ["ip.src"],
  rules: [
    tokenBucket({
      mode: "LIVE",
      refillRate: 10,
      interval: 60,
      capacity: 20,
    }),
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE"],
    }),
  ],
});

app.get("/api/data", async (req, res) => {
  const decision = await aj.protect(req);

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return res.status(429).json({ error: "Too many requests" });
    }
    if (decision.reason.isBot()) {
      return res.status(403).json({ error: "Bot detected" });
    }
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json({ items: [{ id: 1, name: "Widget" }] });
});

app.listen(3000);
