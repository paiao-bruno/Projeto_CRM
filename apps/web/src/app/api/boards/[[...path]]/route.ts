import { getBoardsService } from "@/server/boards";
import { router } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const boards = () => getBoardsService();

export const { GET, POST, PATCH, DELETE } = router([
  { method: "GET", path: "", permission: "chat.read", handler: ({ user }) => boards().list(user) },
  { method: "POST", path: "", permission: "chat.transfer", handler: ({ user, body }) => boards().save(user, body), status: 201 },
  { method: "PATCH", path: ":id", permission: "chat.transfer", handler: ({ user, params, body }) => boards().save(user, body, String(params.id)) },
  { method: "POST", path: ":id/archive", permission: "chat.transfer", handler: ({ user, params }) => boards().archive(user, String(params.id)) },
  { method: "GET", path: ":id", permission: "chat.read", handler: ({ user, params, query }) => boards().get(user, String(params.id), query.get("search") ?? undefined) },
  { method: "POST", path: ":id/columns", permission: "chat.transfer", handler: ({ user, params, body }) => boards().saveColumn(user, String(params.id), body), status: 201 },
  { method: "POST", path: ":id/cards", permission: "chat.reply", handler: ({ user, params, body }) => boards().addCard(user, String(params.id), body), status: 201 },
  { method: "POST", path: ":id/cards/:cardId/move", permission: "chat.reply", handler: ({ user, params, body }) => boards().moveCard(user, String(params.id), String(params.cardId), body) },
]);
