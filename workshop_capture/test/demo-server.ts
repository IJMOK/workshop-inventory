// Runs the app against a fake Homebox and fake AI, for trying the UI without a Pi.
// Sign in as rob@example.com / pw.   node test/demo-server.ts
import { FakeHomebox } from "./fake-homebox.ts";
import { fakeAi, startApp } from "./helpers.ts";

const hb = await new FakeHomebox().start();
const garage = hb.addLocation("Garage");
hb.addLocation("Metal shop", garage);
hb.addLocation("Wood shop", garage);
hb.addLocation("Brewery", garage);
const app = await startApp(hb.url, fakeAi);
console.log(`Demo running at ${app.url}`);
