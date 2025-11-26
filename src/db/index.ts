import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

const dbPath = path.join(__dirname, "..", "..", "data", "prompts.db");

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

// Initialize database
export function initializeDatabase(): void {
    // Bun's SQLite automatically creates/opens the file
    sqlDb = new Database(dbPath);

    // Enable WAL mode for better performance
    sqlDb.run("PRAGMA journal_mode = WAL");

    // Create Drizzle instance
    db = drizzle(sqlDb, { schema });

    // Create tables if they don't exist
    const tableDefinitions = [
        `CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            parent_version_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (parent_version_id) REFERENCES prompts(id)
        )`,
        `CREATE TABLE IF NOT EXISTS test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id INTEGER NOT NULL,
            input TEXT NOT NULL,
            expected_output TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS test_jobs (
            id TEXT PRIMARY KEY,
            prompt_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            total_tests INTEGER NOT NULL DEFAULT 0,
            completed_tests INTEGER NOT NULL DEFAULT 0,
            results TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id)
        )`,
        `CREATE TABLE IF NOT EXISTS test_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            test_case_id INTEGER NOT NULL,
            llm_provider TEXT NOT NULL,
            run_number INTEGER NOT NULL,
            actual_output TEXT,
            is_correct INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES test_jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS improvement_jobs (
            id TEXT PRIMARY KEY,
            prompt_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            current_iteration INTEGER NOT NULL DEFAULT 0,
            max_iterations INTEGER NOT NULL,
            best_score REAL,
            best_prompt_content TEXT,
            best_prompt_version_id INTEGER,
            log TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id),
            FOREIGN KEY (best_prompt_version_id) REFERENCES prompts(id)
        )`,
    ];

    for (const sql of tableDefinitions) {
        sqlDb.run(sql);
    }
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
