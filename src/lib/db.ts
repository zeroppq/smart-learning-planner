import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const TABLE_NAMES = [
  "learning_goal",
  "source_material",
  "knowledge_point",
  "plan",
  "daily_task",
  "mastery_record",
  "study_session",
  "adjustment_proposal",
] as const;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS learning_goal (
  learning_goal_id TEXT PRIMARY KEY,
  goal_text TEXT NOT NULL,
  daily_minutes INTEGER NOT NULL DEFAULT 40,
  target_date TEXT,
  goal_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_material (
  source_material_id TEXT PRIMARY KEY,
  material_name TEXT NOT NULL,
  material_format TEXT NOT NULL,
  material_text TEXT NOT NULL DEFAULT '',
  parse_status TEXT NOT NULL DEFAULT 'processing',
  paragraph_count INTEGER NOT NULL DEFAULT 0,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_point (
  knowledge_point_id TEXT PRIMARY KEY,
  source_material_id TEXT NOT NULL,
  point_title TEXT NOT NULL,
  chapter_name TEXT NOT NULL DEFAULT '',
  paragraph_index INTEGER NOT NULL DEFAULT 0,
  paragraph_text TEXT NOT NULL DEFAULT '',
  prerequisite_point_id TEXT,
  knowledge_point_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_material_id) REFERENCES source_material (source_material_id)
);

CREATE TABLE IF NOT EXISTS plan (
  plan_id TEXT PRIMARY KEY,
  learning_goal_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 1,
  plan_status TEXT NOT NULL DEFAULT 'active',
  route_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (learning_goal_id) REFERENCES learning_goal (learning_goal_id)
);

CREATE TABLE IF NOT EXISTS daily_task (
  daily_task_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  task_date TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 20,
  task_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plan (plan_id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_point (knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS mastery_record (
  mastery_record_id TEXT PRIMARY KEY,
  knowledge_point_id TEXT NOT NULL UNIQUE,
  mastery_status TEXT NOT NULL DEFAULT 'not_started',
  explain_result TEXT NOT NULL DEFAULT 'not_attempted',
  practice_result TEXT NOT NULL DEFAULT 'not_attempted',
  apply_result TEXT NOT NULL DEFAULT 'not_attempted',
  rejudge_used INTEGER NOT NULL DEFAULT 0,
  weak_point_flag INTEGER NOT NULL DEFAULT 0,
  review_due_at TEXT,
  last_studied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_point (knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS study_session (
  study_session_id TEXT PRIMARY KEY,
  knowledge_point_id TEXT NOT NULL,
  session_stage TEXT NOT NULL,
  study_started_at TEXT NOT NULL,
  study_ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_point (knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS adjustment_proposal (
  adjustment_proposal_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  proposal_reason TEXT NOT NULL,
  proposal_content TEXT NOT NULL,
  proposal_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plan (plan_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_point_material ON knowledge_point (source_material_id);
CREATE INDEX IF NOT EXISTS idx_daily_task_plan_date ON daily_task (plan_id, task_date);
CREATE INDEX IF NOT EXISTS idx_mastery_status ON mastery_record (mastery_status);
`;

export function resolveDatabaseFile(): string {
  const configured = process.env.DATABASE_FILE?.trim();
  if (configured) {
    return configured;
  }
  return join(process.cwd(), "data", "learning-planner.db");
}

export function createDatabase(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (filePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(SCHEMA_SQL);
  ensureSchemaColumns(db);
  return db;
}

function ensureSchemaColumns(db: DatabaseSync): void {
  addColumnIfMissing(db, "knowledge_point", "prerequisite_point_id", "TEXT");
  addColumnIfMissing(db, "plan", "route_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, "mastery_record", "review_count", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

let databaseInstance: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (!databaseInstance) {
    databaseInstance = createDatabase(resolveDatabaseFile());
  }
  return databaseInstance;
}

export function closeDatabase(): void {
  if (databaseInstance) {
    databaseInstance.close();
    databaseInstance = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}