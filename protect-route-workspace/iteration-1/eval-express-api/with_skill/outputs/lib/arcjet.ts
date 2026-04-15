import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";

export { detectBot, slidingWindow, shield };

export default arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    // Base rule: protect against common web attacks (SQLi, XSS, etc.)
    shield({ mode: "LIVE" }),
  ],
});
