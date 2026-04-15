import arcjet, { shield, fixedWindow, detectBot } from "@arcjet/next";

export default arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
    fixedWindow({
      mode: "LIVE",
      window: "60s",
      max: 5,
      characteristics: ["ip.src"],
    }),
    detectBot({
      mode: "LIVE",
      allow: [],
    }),
  ],
});
