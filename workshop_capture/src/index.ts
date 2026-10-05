import { loadConfig } from "./config.ts";
import { createProvider } from "./ai/index.ts";
import { buildServer } from "./server.ts";

const config = loadConfig();
const ai = createProvider(config.ai);
buildServer({ config, ai }).listen(config.port, () => {
  console.log(`Workshop Capture listening on :${config.port} (Homebox ${config.homeboxUrl}, AI ${ai?.name ?? "off"})`);
});
