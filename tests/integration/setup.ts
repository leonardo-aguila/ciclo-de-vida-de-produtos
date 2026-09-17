/** Integration tests run against TEST_DATABASE_URL; never the development one. */
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL não definida — veja .env.example.");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// NODE_ENV is typed read-only by @types/node; assign through the record.
(process.env as Record<string, string>).NODE_ENV = "test";
