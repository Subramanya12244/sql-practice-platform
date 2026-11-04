import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

worker({
  async init() {
    const db = new PGlite();
    const res = await fetch("/data/northwind.sql");
    if (!res.ok) throw new Error(`Could not load Northwind data (${res.status})`);
    await db.exec(await res.text());
    return db;
  },
});
