-- Add SGP as an integration provider for per-tenant credential storage.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'SGP';
