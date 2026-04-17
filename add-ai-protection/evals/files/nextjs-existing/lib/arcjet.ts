import arcjet, { detectBot, slidingWindow } from "@arcjet/next";

export { detectBot, slidingWindow };

export default arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [],
});
