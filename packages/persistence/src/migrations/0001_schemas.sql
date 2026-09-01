-- Schemas. (In the dev container these already exist via 00-init.sql; this
-- makes migrations self-sufficient for testcontainers and CI.)
create schema if not exists events;
create schema if not exists projections;
create schema if not exists identity;
create schema if not exists session;
create schema if not exists scheduler;
create schema if not exists audit;
