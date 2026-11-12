import { createAppServer, HOST, PORT } from '../src/app-server.js';

const server = createAppServer();
server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`Sonora music server running at http://${displayHost}:${PORT} (listening on ${HOST}:${PORT})`);
});
