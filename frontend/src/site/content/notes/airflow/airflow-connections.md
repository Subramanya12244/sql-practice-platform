---
title: Connections
slug: airflow-connections
category: airflow
difficulty: Beginner
description: Store credentials in Airflow Connections via UI, CLI, env vars or a secrets backend, and use them through hooks and conn_id.
prerequisites: [airflow-operators]
related: [airflow-variables, airflow-xcom, airflow-architecture]
questions: []
patterns: []
guides: []
projects: [airflow-etl-pipeline, rest-api-to-postgres]
minutes: 8
version: 1
---

## Introduction

Pipelines talk to databases, buckets and APIs. Connections keep the host, login and password for those systems out of DAG code.

## Definition

A **Connection** is a named record (`conn_id`) with type, host, schema, login, password, port and JSON `extra`. Operators and hooks receive a `conn_id` and look it up at run time.

## Why it matters

Hard-coded secrets leak through Git and logs and must be changed in every DAG. Connections centralise them and can live in a vault.

## How it works

Lookup order for a `conn_id`:

1. Configured secrets backend (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager...).
2. Environment variable `AIRFLOW_CONN_<CONN_ID>` (upper case).
3. Metadata database (UI/CLI-created; password encrypted with the Fernet key).

## Syntax and configuration

```bash
# URI form in an environment variable
export AIRFLOW_CONN_WAREHOUSE='postgresql://etl_user:s3cret@warehouse.internal:5432/analytics'

# JSON form (2.3+)
export AIRFLOW_CONN_SALES_API='{"conn_type": "http", "host": "https://api.example.com", "password": "token123"}'

# CLI into the metadata DB
airflow connections add warehouse --conn-uri 'postgresql://etl_user:s3cret@warehouse.internal:5432/analytics'
airflow connections get warehouse
airflow connections test warehouse   # needs test_connection enabled in config
```

Secrets backend:

```bash
export AIRFLOW__SECRETS__BACKEND=airflow.providers.amazon.aws.secrets.secrets_manager.SecretsManagerBackend
export AIRFLOW__SECRETS__BACKEND_KWARGS='{"connections_prefix": "airflow/connections"}'
```

## Examples

```python-syntax
from airflow.decorators import task
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.providers.http.hooks.http import HttpHook

@task
def top_customers():
    hook = PostgresHook(postgres_conn_id="warehouse")
    return hook.get_records("SELECT customer_id FROM dim_customer LIMIT 5")

@task
def fetch_orders(ds=None):
    resp = HttpHook(method="GET", http_conn_id="sales_api").run(f"/orders?date={ds}")
    return len(resp.json())
```

## Architecture

```mermaid
flowchart LR
  task["Task with conn_id"] --> hook["Hook"]
  hook --> secrets["Secrets backend"]
  hook --> env["AIRFLOW_CONN_ env var"]
  hook --> metadb["Metadata DB"]
  hook --> system["External system"]
```

The hook resolves credentials in order, then opens the real connection.

## Practical example

Dev, staging and prod use the same DAG code. Each environment defines `warehouse` differently in its secrets backend, so promoting a DAG needs no code changes.

## Exercises

1. Which env var defines connection `my_db`?
   <details><summary>Answer</summary>`AIRFLOW_CONN_MY_DB`.</details>
2. Where do you put extra options like an AWS region?
   <details><summary>Answer</summary>In the connection's `extra` JSON.</details>
3. What encrypts passwords stored in the metadata DB?
   <details><summary>Answer</summary>The Fernet key (`AIRFLOW__CORE__FERNET_KEY`).</details>

## Common mistakes

- Credentials in DAG code or Variables.
- Opening hook connections at DAG top level (runs on every parse).
- Losing the Fernet key, which makes stored passwords unreadable.
- Special characters not URL-encoded in connection URIs.

## Performance and best practices

- Use a secrets backend in production.
- One `conn_id` per logical system, consistent across environments.
- Grant each connection least-privilege credentials.
- Create hooks inside task code only.

## Interview questions

### How does Airflow manage credentials?

Through Connections identified by `conn_id`, resolved from a secrets backend, env vars or the encrypted metadata DB.

### What is the difference between a Connection and a hook?

The Connection stores credentials; the hook is code that uses them to talk to the system.

### How do you keep secrets out of the metadata DB?

Configure a secrets backend such as Vault or AWS Secrets Manager.

### How do you manage connections across environments?

Same `conn_id` in every environment, different values per environment's secrets store.

## Quick revision

- Connection = named credentials (`conn_id`).
- Lookup: secrets backend, env var, metadata DB.
- `AIRFLOW_CONN_<ID>` env vars, URI or JSON.
- Hooks use connections; operators use hooks.
- Fernet key encrypts DB-stored passwords.
- Never hard-code secrets.
