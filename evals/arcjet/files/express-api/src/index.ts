import express from "express";

const app = express();
app.use(express.json());

// Public product catalog - no auth required
app.get("/api/products", async (req, res) => {
  res.json({
    products: [
      { id: 1, name: "Widget", price: 9.99 },
      { id: 2, name: "Gadget", price: 19.99 },
    ],
  });
});

// Search endpoint - can be expensive
app.get("/api/search", async (req, res) => {
  const query = req.query.q as string;
  // Simulated search
  res.json({ results: [], query });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
