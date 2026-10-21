/**
 * Migration 172: the circuit-breaker auto-pause switch (spec 111).
 *
 * `settings.workflow_circuit_breaker_auto_pause_queue` records whether a
 * tripped breaker parks the fleet admission queue (INTEGER 0/1), or NULL when
 * the install has never chosen.
 *
 * NULL and 0 both mean "do not park", which is the shipped default: a trip is
 * reported, and `shep fleet pause` / `shep fleet resume` is the lever. The
 * switch exists so the behaviour can be turned on without a code change once
 * the web dashboard can both show a pause and release it — the dashboard's own
 * reads are the most common thing that trips the breaker, so enabling this
 * before a web resume surface exists strands a web user with no way out.
 *
 * Additive and idempotent. NULL preserves the behaviour of every install that
 * predates this migration, and matches `FleetCircuitBreakerSettings`'s reserved
 * field being reported-but-not-acted-on.
 */

import type { MigrationParams } from 'umzug';
import type Database from 'better-sqlite3';
import { addColumn } from '../add-column.js';

export async function up({ context: db }: MigrationParams<Database.Database>): Promise<void> {
  addColumn(db, 'settings', 'workflow_circuit_breaker_auto_pause_queue', 'INTEGER');
}

export async function down(_params: MigrationParams<Database.Database>): Promise<void> {
  // Additive migration: a nullable column is harmless to an older build.
}
