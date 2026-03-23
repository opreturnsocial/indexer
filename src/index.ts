import "dotenv/config";
import { createServer } from "./server.js";
import { startScanner } from "./scanner.js";

const PORT = parseInt(process.env.PORT ?? "3010", 10);

const app = createServer();
app.listen(PORT, () => {
  console.log(`[indexer] HTTP server listening on port ${PORT}`);
});

startScanner();
