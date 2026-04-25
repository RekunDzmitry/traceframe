// seed.mjs — Read JSONL trace files from ./data/traces and insert into Postgres.
// Usage: node seed.mjs
//
// Expects POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB env vars
// (defaults to localhost / traceframe / traceframe / traceframe).

import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || "traceframe",
  password: process.env.POSTGRES_PASSWORD || "traceframe",
  database: process.env.POSTGRES_DB || "traceframe",
});

const TRACES_DIR = process.argv[2] || "./data/traces";

async function seed() {
  const files = readdirSync(TRACES_DIR).filter((f) => f.endsWith(".jsonl"));
  console.log(`Found ${files.length} trace files in ${TRACES_DIR}`);

  const client = await pool.connect();
  let totalEvents = 0;

  try {
    for (const file of files) {
      const traceId = file.replace(/\.jsonl$/, "");
      const filePath = join(TRACES_DIR, file);
      console.log(`  Seeding ${traceId} ...`);

      await client.query("BEGIN");

      // Upsert trace row
      await client.query(
        `INSERT INTO traces (trace_id, inserted_at, updated_at, event_count, total_bytes)
         VALUES ($1, NOW(), NOW(), 0, 0)
         ON CONFLICT (trace_id) DO UPDATE SET updated_at = NOW()`,
        [traceId]
      );

      // Stream JSONL lines and batch-insert
      const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
      let batch = [];
      const BATCH_SIZE = 500;
      let fileEvents = 0;

      let lineNum = 0;
      for await (const line of rl) {
        lineNum++;
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch (e) {
          console.warn(`    Bad JSON in ${traceId} line ${lineNum}, skipping`);
          continue;
        }
        // Postgres rejects \u0000 in text/jsonb — strip them from JSON string
        // JSON.stringify encodes null bytes as the literal 6-char sequence "\u0000"
        try {
          const json = JSON.stringify(event).replace(/\\u0000/g, "");
          const cleaned = JSON.parse(json);
          const eventType = cleaned.type || "unknown";
          batch.push([traceId, eventType, cleaned]);
          fileEvents++;
        } catch (e) {
          console.warn(`    Error sanitizing ${traceId} line ${lineNum}: ${e.message}`);
          continue;
        }

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(client, batch);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await flushBatch(client, batch);
      }

      // Update counters
      await client.query(
        `UPDATE traces SET event_count = (SELECT count(*) FROM events WHERE trace_id = $1),
                          total_bytes  = (SELECT COALESCE(sum(octet_length(raw::text)), 0)::bigint FROM events WHERE trace_id = $1)
         WHERE trace_id = $1`,
        [traceId]
      );

      await client.query("COMMIT");
      totalEvents += fileEvents;
      console.log(`    → ${fileEvents} events`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  await pool.end();
  console.log(`\nDone. ${files.length} traces, ${totalEvents} events total.`);
}

async function flushBatch(client, batch) {
  const traceIds = batch.map((b) => b[0]);
  const types = batch.map((b) => b[1]);
  const raws = batch.map((b) => b[2]);

  await client.query(
    `INSERT INTO events (trace_id, event_type, raw)
     SELECT * FROM unnest($1::text[], $2::text[], $3::jsonb[])`,
    [traceIds, types, raws]
  );
}

seed();
