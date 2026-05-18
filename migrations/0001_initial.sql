-- 0001_initial — create users table.
--
-- Migrations are applied in ascending filename order, wrapped in a transaction,
-- and recorded in the _migrations table. Never edit an applied migration —
-- create a new one that ALTERs.

CREATE TABLE IF NOT EXISTS users (
    id    TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
);
