import { getCampaignsService } from "@/server/campaigns";
import { router } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const campaigns = () => getCampaignsService();

export const { GET, POST, PATCH } = router([
  { method: "GET", path: "", permission: "sales_funnel.read", handler: ({ user, query }) => campaigns().list(user, query) },
  {
    method: "GET",
    path: "whatsapp/overview",
    permission: "sales_funnel.read",
    handler: ({ user, query }) => campaigns().whatsappOverview(user, query),
  },
  { method: "GET", path: ":id", permission: "sales_funnel.read", handler: ({ user, params }) => campaigns().get(user, String(params.id)) },
  { method: "POST", path: "", permission: "sales_funnel.manage", handler: ({ user, body }) => campaigns().create(user, body), status: 201 },
  { method: "PATCH", path: ":id", permission: "sales_funnel.manage", handler: ({ user, params, body }) => campaigns().update(user, String(params.id), body) },
  {
    method: "POST",
    path: ":id/archive",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => campaigns().archive(user, String(params.id)),
  },
  {
    method: "POST",
    path: ":id/send",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => campaigns().refuseSend(user, String(params.id)),
  },
  {
    method: "POST",
    path: ":id/pause",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => campaigns().refuseSend(user, String(params.id)),
  },
  {
    method: "POST",
    path: ":id/resume",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => campaigns().refuseSend(user, String(params.id)),
  },
  {
    method: "POST",
    path: ":id/cancel",
    permission: "sales_funnel.manage",
    handler: ({ user, params }) => campaigns().refuseSend(user, String(params.id)),
  },
]);
