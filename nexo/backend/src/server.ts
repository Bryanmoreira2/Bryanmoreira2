import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { createApp } from './app.js';

const db = openDatabase(config.databasePath);
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`NEXO JOVEM API ouvindo em http://localhost:${config.port}`);
});

function encerrar() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
