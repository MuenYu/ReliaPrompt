import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

const dbPath = path.join(__dirname, "..", "..", "data", "prompts.db");
const migrationsPath = path.join(__dirname, "..", "..", "drizzle");

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let sqlDb: Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Wrapper for write operations. With Bun's SQLite, persistence is automatic,
 * so this is just a pass-through for consistency with the existing API.
 */
export function withSave<T>(operation: () => T): T {
    return operation();
}

// Initialize database and run migrations
export function initializeDatabase(): void {
    // Bun's SQLite automatically creates/opens the file
    sqlDb = new Database(dbPath);

    // Enable WAL mode for better performance
    sqlDb.run("PRAGMA journal_mode = WAL");

    // Create Drizzle instance
    db = drizzle(sqlDb, { schema });

    // Run migrations
    migrate(db, { migrationsFolder: migrationsPath });
}

export function getDb() {
    if (!db) {
        throw new Error("Database not initialized. Call initializeDatabase() first.");
    }
    return db;
}

export function getSqlDb() {
    if (!sqlDb) {
        throw new Error("Database not initialized. Call initializeDatabase() first.");
    }
    return sqlDb;
}

export { schema };
