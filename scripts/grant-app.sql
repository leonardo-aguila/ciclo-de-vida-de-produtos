-- Run after every migration: the application role gets DML on every table,
-- except audit_logs, where it may only INSERT and SELECT.
-- That is what makes the audit trail append-only at the database level
-- instead of only by convention in the code.
GRANT USAGE ON SCHEMA public TO portfolio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO portfolio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO portfolio_app;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM portfolio_app;
GRANT SELECT, INSERT ON TABLE audit_logs TO portfolio_app;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE access_logs FROM portfolio_app;
GRANT SELECT, INSERT ON TABLE access_logs TO portfolio_app;
