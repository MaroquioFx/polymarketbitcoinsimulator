import 'dotenv/config';
import express from "express";
import { AssistantEngine } from "./src/engine.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static("public"));

const engine = new AssistantEngine();
let clients = [];

engine.onUpdate = (data) => {
  clients.forEach((client) => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
};

engine.start();

app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { id: Date.now(), res };
  clients.push(client);

  req.on("close", () => {
    clients = clients.filter((c) => c.id !== client.id);
  });
});

app.post("/config", (req, res) => {
  const { interval, seriesId, marketSlug, autoDetect } = req.body;
  if (interval) engine.updateInterval(parseInt(interval));
  if (seriesId) engine.updateSeriesId(seriesId);
  if (marketSlug !== undefined) engine.updateMarketSlug(marketSlug); // Can be empty string for auto
  if (autoDetect !== undefined) engine.config.autoDetect = !!autoDetect;
  
  res.json({ success: true, config: engine.config });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
