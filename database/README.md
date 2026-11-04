# Database

## Practice database (`northwind`)

- `schema.sql` — Northwind-style tables  
- `seed.sql` — Realistic sample data (91 customers, 77 products, 9 employees, orders, etc.)  
- `init.sh` — Docker first-boot: creates DBs, roles, applies schema/seed, grants **SELECT-only** to `sql_readonly`

## App database (`sql_practice`)

Created empty; FastAPI/SQLAlchemy creates tables on startup:

- `users`, `questions`, `solutions`, `attempts`, `progress_events`

Never store application metadata in the Northwind schema.

## Pointing at an existing database

See the root README section **Connect to your existing PostgreSQL / Northwind**.
