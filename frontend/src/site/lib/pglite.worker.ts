import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

/**
 * One PGlite instance per dataset (each in its own worker), so a query can only ever
 * see the database it was sent to. `meta.url` loads a shipped dataset; `meta.sql` loads
 * a dataset the visitor generated or imported in this browser.
 */
worker({
  async init(options) {
    const meta = (options.meta ?? {}) as { url?: string; sql?: string };
    const db = new PGlite();
    let sql = meta.sql;
    if (!sql) {
      const url = meta.url ?? "/data/northwind.sql";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load dataset (${res.status})`);
      sql = await res.text();
    }
    await db.exec(sql);
    return db;
  },
});
