import express from "express";

const app = express();
app.use(express.json());

app.get("/api/data", (req, res) => {
  res.json({ items: [{ id: 1, name: "Widget" }] });
});

app.listen(3000);
