import { NextResponse } from "next/server";
import { TABLE_NAMES, getDatabase } from "@/lib/db";

export async function GET() {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableNames = rows.map((row) => row.name).sort();

  return NextResponse.json({
    ok: tableNames.length === TABLE_NAMES.length,
    databaseFile: process.env.DATABASE_FILE ?? "data/learning-planner.db",
    tableCount: tableNames.length,
    tableNames,
  });
}