import { getAccessService } from "@/server/access";
import { getDistributionService } from "@/server/distribution";
import { getOpsService } from "@/server/ops";
import { getSectorsService } from "@/server/sectors";
import { getTeamService } from "@/server/team";
import { router } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const team = () => getTeamService();
const sectors = () => getSectorsService();
const dist = () => getDistributionService();
const ops = () => getOpsService();

export const { GET, POST, PATCH, DELETE } = router([
  { method: "GET", path: "members", permission: "team.manage", handler: ({ user, query }) => team().list(user, query) },
  { method: "GET", path: "roles", permission: "team.manage", handler: ({ user }) => team().listRoles(user) },
  { method: "POST", path: "members", permission: "team.manage", handler: ({ user, body }) => team().create(user, body), status: 201 },
  { method: "PATCH", path: "members/:id", permission: "team.manage", handler: ({ user, params, body }) => team().update(user, String(params.id), body) },
  { method: "POST", path: "members/:id/deactivate", permission: "team.manage", handler: ({ user, params, body }) => team().deactivate(user, String(params.id), body) },
  { method: "POST", path: "members/:id/reset-link", permission: "team.manage", handler: ({ user, params }) => getAccessService().issueResetLink(user, String(params.id)) },

  { method: "GET", path: "sectors", permission: "team.manage", handler: ({ user }) => sectors().list(user) },
  { method: "POST", path: "sectors", permission: "team.manage", handler: ({ user, body }) => sectors().save(user, body), status: 201 },
  { method: "PATCH", path: "sectors/:id", permission: "team.manage", handler: ({ user, params, body }) => sectors().save(user, body, String(params.id)) },
  { method: "POST", path: "sectors/:id/archive", permission: "team.manage", handler: ({ user, params, body }) => sectors().archive(user, String(params.id), body) },
  { method: "GET", path: "sector-categories", permission: "team.manage", handler: ({ user }) => sectors().listCategories(user) },
  { method: "POST", path: "sector-categories", permission: "team.manage", handler: ({ user, body }) => sectors().saveCategory(user, body), status: 201 },
  { method: "PATCH", path: "sector-categories/:id", permission: "team.manage", handler: ({ user, params, body }) => sectors().saveCategory(user, body, String(params.id)) },
  { method: "POST", path: "sector-categories/:id/archive", permission: "team.manage", handler: ({ user, params, body }) => sectors().archiveCategory(user, String(params.id), body) },

  { method: "GET", path: "round-robin", permission: "team.manage", handler: ({ user }) => dist().listRules(user) },
  { method: "POST", path: "round-robin", permission: "team.manage", handler: ({ user, body }) => dist().saveRule(user, body), status: 201 },
  { method: "PATCH", path: "round-robin/:id", permission: "team.manage", handler: ({ user, params, body }) => dist().saveRule(user, body, String(params.id)) },
  { method: "DELETE", path: "round-robin/:id", permission: "team.manage", handler: ({ user, params }) => dist().removeRule(user, String(params.id)) },
  { method: "POST", path: "round-robin/run", permission: "chat.transfer", handler: ({ user }) => dist().distributeQueue(user.tenantId) },

  { method: "GET", path: "history", permission: "chat.transfer", handler: ({ user, query }) => ops().search(user, query) },
  { method: "GET", path: "history/export", permission: "chat.transfer", handler: ({ user, query }) => ops().exportCsv(user, query) },
  { method: "POST", path: "batch/preview", permission: "chat.transfer", handler: ({ user, body }) => ops().previewBatch(user, Array.isArray(body.ids) ? body.ids.map(String) : []) },
  { method: "POST", path: "batch", permission: "chat.transfer", handler: ({ user, body }) => ops().runBatch(user, body) },

  { method: "GET", path: "audit", permission: "audit.read", handler: ({ user, query }) => ops().listAudit(user, query) },
]);
