import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import path from "path";

const DB_PATH = path.join(process.cwd(), "deadlock.db");

const sqlite = new Database(DB_PATH);

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
