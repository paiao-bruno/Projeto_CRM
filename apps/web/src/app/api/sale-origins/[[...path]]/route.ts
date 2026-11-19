import { getSaleOriginsService } from "@/server/campaigns";
import { router } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origins = () => getSaleOriginsService();

export const { GET, POST, PATCH } = router([
  { method: "GET", path: "", permission: "sales_funnel.read", handler: ({ user, query }) => origins().list(user, query) },
  { method: "POST", path: "", permission: "sales_funnel.manage", handler: ({ user, body }) => origins().create(user, body), status: 201 },
  { method: "PATCH", path: ":id", permission: "sales_funnel.manage", handler: ({ user, params, body }) => origins().update(user, String(params.id), body) },
  {
    method: "POST",
    path: ":id/activate",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => origins().setActive(user, String(params.id), true),
  },
  {
    method: "POST",
    path: ":id/deactivate",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => origins().setActive(user, String(params.id), false),
  },
]);
