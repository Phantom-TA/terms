-- Runs once when the local Postgres volume is first created.
-- A separate database keeps integration tests from touching development data.
CREATE DATABASE terms_test OWNER terms;
