import { migrate } from "./migrate.js";

const { DATABASE_URL, VISITANTE_PASSWORD } = process.env;
if (!DATABASE_URL || !VISITANTE_PASSWORD) {
  console.error("Defina DATABASE_URL e VISITANTE_PASSWORD (veja o .env.example).");
  process.exit(1);
}
await migrate(DATABASE_URL, VISITANTE_PASSWORD);
