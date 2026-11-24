CREATE UNIQUE INDEX "SgpChurnSnapshot_tenantId_running_key" ON "SgpChurnSnapshot" ("tenantId") WHERE status = 'RUNNING';
