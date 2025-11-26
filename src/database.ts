import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, '..', 'data', 'prompts.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: SqlJsDatabase | null = null;

// Save database to file
function saveDatabase(): void {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Initialize database
export async function initializeDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      parent_version_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parent_version_id) REFERENCES prompts(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS test_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER NOT NULL,
      input TEXT NOT NULL,
      expected_output TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS test_jobs (
      id TEXT PRIMARY KEY,
      prompt_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_tests INTEGER NOT NULL DEFAULT 0,
      completed_tests INTEGER NOT NULL DEFAULT 0,
      results TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (prompt_id) REFERENCES prompts(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      test_case_id INTEGER NOT NULL,
      llm_provider TEXT NOT NULL,
      run_number INTEGER NOT NULL,
      actual_output TEXT,
      is_correct INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES test_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS improvement_jobs (
      id TEXT PRIMARY KEY,
      prompt_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_iteration INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL,
      best_score REAL,
      best_prompt_content TEXT,
      best_prompt_version_id INTEGER,
      log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (prompt_id) REFERENCES prompts(id),
      FOREIGN KEY (best_prompt_version_id) REFERENCES prompts(id)
    )
  `);

  saveDatabase();
}

function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// Helper to run a query and return results as objects
function queryAll<T>(sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function queryOne<T>(sql: string, params: (string | number | null)[] = []): T | null {
  const results = queryAll<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

function runSql(sql: string, params: (string | number | null)[] = []): number {
  getDb().run(sql, params);
  saveDatabase();
  // Get last insert rowid
  const result = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return result?.id ?? 0;
}

// Config operations
export function getConfig(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM config WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  getDb().run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value]);
  saveDatabase();
}

export function getAllConfig(): Record<string, string> {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM config');
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

// Prompt operations
export interface Prompt {
  id: number;
  name: string;
  content: string;
  version: number;
  parent_version_id: number | null;
  created_at: string;
}

export function createPrompt(name: string, content: string, parentVersionId?: number): Prompt {
  let version = 1;
  if (parentVersionId) {
    const parent = queryOne<{ version: number }>('SELECT version FROM prompts WHERE id = ?', [parentVersionId]);
    if (parent) {
      version = parent.version + 1;
    }
  }
  
  const createdAt = new Date().toISOString();
  runSql(
    'INSERT INTO prompts (name, content, version, parent_version_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, content, version, parentVersionId ?? null, createdAt]
  );
  
  const result = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return getPromptById(result?.id ?? 0)!;
}

export function getPromptById(id: number): Prompt | null {
  return queryOne<Prompt>('SELECT * FROM prompts WHERE id = ?', [id]);
}

export function getLatestPrompts(): Prompt[] {
  return queryAll<Prompt>(`
    SELECT p1.* FROM prompts p1
    INNER JOIN (
      SELECT name, MAX(version) as max_version
      FROM prompts
      GROUP BY name
    ) p2 ON p1.name = p2.name AND p1.version = p2.max_version
    ORDER BY p1.created_at DESC
  `);
}

export function getPromptVersions(name: string): Prompt[] {
  return queryAll<Prompt>('SELECT * FROM prompts WHERE name = ? ORDER BY version DESC', [name]);
}

export function getAllPrompts(): Prompt[] {
  return queryAll<Prompt>('SELECT * FROM prompts ORDER BY name, version DESC');
}

// Test case operations
export interface TestCase {
  id: number;
  prompt_id: number;
  input: string;
  expected_output: string;
  created_at: string;
}

export function createTestCase(promptId: number, input: string, expectedOutput: string): TestCase {
  const createdAt = new Date().toISOString();
  runSql(
    'INSERT INTO test_cases (prompt_id, input, expected_output, created_at) VALUES (?, ?, ?, ?)',
    [promptId, input, expectedOutput, createdAt]
  );
  
  const result = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return getTestCaseById(result?.id ?? 0)!;
}

export function getTestCaseById(id: number): TestCase | null {
  return queryOne<TestCase>('SELECT * FROM test_cases WHERE id = ?', [id]);
}

export function getTestCasesForPrompt(promptId: number): TestCase[] {
  return queryAll<TestCase>('SELECT * FROM test_cases WHERE prompt_id = ? ORDER BY created_at', [promptId]);
}

export function getTestCasesForPromptName(promptName: string): TestCase[] {
  return queryAll<TestCase>(`
    SELECT tc.* FROM test_cases tc
    INNER JOIN prompts p ON tc.prompt_id = p.id
    WHERE p.name = ?
    ORDER BY tc.created_at
  `, [promptName]);
}

export function deleteTestCase(id: number): void {
  getDb().run('DELETE FROM test_cases WHERE id = ?', [id]);
  saveDatabase();
}

// Test job operations
export interface TestJob {
  id: string;
  prompt_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_tests: number;
  completed_tests: number;
  results: string | null;
  created_at: string;
  updated_at: string;
}

export function createTestJob(id: string, promptId: number, totalTests: number): TestJob {
  const now = new Date().toISOString();
  getDb().run(
    'INSERT INTO test_jobs (id, prompt_id, status, total_tests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, promptId, 'pending', totalTests, now, now]
  );
  saveDatabase();
  
  return getTestJobById(id)!;
}

export function getTestJobById(id: string): TestJob | null {
  return queryOne<TestJob>('SELECT * FROM test_jobs WHERE id = ?', [id]);
}

export function updateTestJob(id: string, updates: Partial<TestJob>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.completed_tests !== undefined) {
    fields.push('completed_tests = ?');
    values.push(updates.completed_tests);
  }
  if (updates.results !== undefined) {
    fields.push('results = ?');
    values.push(updates.results);
  }
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  getDb().run(`UPDATE test_jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();
}

// Test result operations
export interface TestResult {
  id: number;
  job_id: string;
  test_case_id: number;
  llm_provider: string;
  run_number: number;
  actual_output: string | null;
  is_correct: number;
  error: string | null;
  created_at: string;
}

export function createTestResult(
  jobId: string,
  testCaseId: number,
  llmProvider: string,
  runNumber: number,
  actualOutput: string | null,
  isCorrect: boolean,
  error?: string
): TestResult {
  const createdAt = new Date().toISOString();
  getDb().run(
    'INSERT INTO test_results (job_id, test_case_id, llm_provider, run_number, actual_output, is_correct, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [jobId, testCaseId, llmProvider, runNumber, actualOutput, isCorrect ? 1 : 0, error ?? null, createdAt]
  );
  saveDatabase();
  
  const result = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return queryOne<TestResult>('SELECT * FROM test_results WHERE id = ?', [result?.id ?? 0])!;
}

export function getTestResultsForJob(jobId: string): TestResult[] {
  return queryAll<TestResult>('SELECT * FROM test_results WHERE job_id = ? ORDER BY test_case_id, llm_provider, run_number', [jobId]);
}

// Improvement job operations
export interface ImprovementJob {
  id: string;
  prompt_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_iteration: number;
  max_iterations: number;
  best_score: number | null;
  best_prompt_content: string | null;
  best_prompt_version_id: number | null;
  log: string | null;
  created_at: string;
  updated_at: string;
}

export function createImprovementJob(id: string, promptId: number, maxIterations: number): ImprovementJob {
  const now = new Date().toISOString();
  getDb().run(
    'INSERT INTO improvement_jobs (id, prompt_id, max_iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, promptId, maxIterations, now, now]
  );
  saveDatabase();
  
  return getImprovementJobById(id)!;
}

export function getImprovementJobById(id: string): ImprovementJob | null {
  return queryOne<ImprovementJob>('SELECT * FROM improvement_jobs WHERE id = ?', [id]);
}

export function updateImprovementJob(id: string, updates: Partial<ImprovementJob>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.current_iteration !== undefined) {
    fields.push('current_iteration = ?');
    values.push(updates.current_iteration);
  }
  if (updates.best_score !== undefined) {
    fields.push('best_score = ?');
    values.push(updates.best_score);
  }
  if (updates.best_prompt_content !== undefined) {
    fields.push('best_prompt_content = ?');
    values.push(updates.best_prompt_content);
  }
  if (updates.best_prompt_version_id !== undefined) {
    fields.push('best_prompt_version_id = ?');
    values.push(updates.best_prompt_version_id);
  }
  if (updates.log !== undefined) {
    fields.push('log = ?');
    values.push(updates.log);
  }
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  getDb().run(`UPDATE improvement_jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();
}

export function appendImprovementLog(id: string, message: string): void {
  const job = getImprovementJobById(id);
  const currentLog = job?.log ?? '';
  const timestamp = new Date().toISOString();
  const newLog = currentLog + `[${timestamp}] ${message}\n`;
  updateImprovementJob(id, { log: newLog });
}
