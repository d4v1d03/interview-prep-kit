import { startFixtureServer } from "../fixtures/server";

const port = Number(process.env.PORT ?? 8099);
const { url } = await startFixtureServer(port);
console.log(`Fixture company sites at ${url}/acme/, ${url}/globex/, ${url}/initech/ (Ctrl+C to stop)`);
