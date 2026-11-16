import type { PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { canView, actorFrom } from "./inbox/rules";
import { getPrisma } from "./prisma";
import { optionalString, requireUuid, requiredString, type Body } from "./validation";

/**
 * Quadro Ao Vivo: organiza atendimentos já existentes.
 * Mover um cartão NÃO cria oportunidade, NÃO atribui tag, NÃO muda setor e NÃO altera o responsável.
 */
export class BoardsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  list(user: ServerAuthUser) {
    return this.prisma.conversationBoard.findMany({
      where: { tenantId: user.tenantId, archivedAt: null },
      orderBy: { position: "asc" },
      include: { _count: { select: { cards: true } } },
    });
  }

  async save(user: ServerAuthUser, body: Body, id?: string) {
    const name = requiredString(body, "name", 80);
    const position = body.position === undefined ? 0 : Number(body.position) || 0;
    try {
      if (id) {
        const result = await this.prisma.conversationBoard.updateMany({
          where: { id: requireUuid(id), tenantId: user.tenantId, archivedAt: null },
          data: { name, position },
        });
        if (result.count === 0) throw new HttpError(404, "Quadro não encontrado.");
        await recordAudit(this.prisma, user, "board.updated", "ConversationBoard", id);
        return { id };
      }
      const board = await this.prisma.conversationBoard.create({
        data: { tenantId: user.tenantId, name, position },
      });
      await this.prisma.boardColumn.createMany({
        data: [
          { boardId: board.id, tenantId: user.tenantId, name: "Entrada", position: 0, color: "#64748b" },
          { boardId: board.id, tenantId: user.tenantId, name: "Em andamento", position: 1, color: "#365cf5" },
          { boardId: board.id, tenantId: user.tenantId, name: "Aguardando", position: 2, color: "#f28c6f" },
        ],
      });
      await recordAudit(this.prisma, user, "board.created", "ConversationBoard", board.id);
      return { id: board.id };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, "Já existe um quadro com este nome.");
    }
  }

  async archive(user: ServerAuthUser, id: string) {
    const result = await this.prisma.conversationBoard.updateMany({
      where: { id: requireUuid(id), tenantId: user.tenantId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new HttpError(404, "Quadro não encontrado.");
    await recordAudit(this.prisma, user, "board.archived", "ConversationBoard", id);
    return { ok: true };
  }

  async get(user: ServerAuthUser, id: string, search?: string) {
    const board = await this.prisma.conversationBoard.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId, archivedAt: null },
      include: { columns: { orderBy: { position: "asc" } } },
    });
    if (!board) throw new HttpError(404, "Quadro não encontrado.");
    const cards = await this.prisma.boardCard.findMany({
      where: {
        boardId: board.id,
        tenantId: user.tenantId,
        ...(search
          ? {
              conversation: {
                OR: [
                  { protocol: { contains: search, mode: "insensitive" } },
                  { customer: { name: { contains: search, mode: "insensitive" } } },
                ],
              },
            }
          : {}),
      },
      orderBy: { position: "asc" },
      include: {
        conversation: {
          select: {
            id: true,
            protocol: true,
            status: true,
            assignedMemberId: true,
            customer: { select: { name: true, phone: true } },
          },
        },
      },
    });
    const actor = actorFrom(user);
    const visible = cards.filter((card) => canView(actor, card.conversation));
    return {
      id: board.id,
      name: board.name,
      columns: board.columns,
      cards: visible.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        position: card.position,
        version: card.version,
        conversationId: card.conversationId,
        protocol: card.conversation.protocol,
        status: card.conversation.status,
        customer: card.conversation.customer,
      })),
    };
  }

  async saveColumn(user: ServerAuthUser, boardId: string, body: Body, columnId?: string) {
    await this.requireBoard(user, boardId);
    const name = requiredString(body, "name", 80);
    const color = optionalString(body, "color", 7) ?? "#64748b";
    const position = body.position === undefined ? 0 : Number(body.position) || 0;
    if (columnId) {
      const result = await this.prisma.boardColumn.updateMany({
        where: { id: requireUuid(columnId), boardId, tenantId: user.tenantId },
        data: { name, color, position },
      });
      if (result.count === 0) throw new HttpError(404, "Coluna não encontrada.");
      return { id: columnId };
    }
    const column = await this.prisma.boardColumn.create({
      data: { boardId, tenantId: user.tenantId, name, color, position },
    });
    return { id: column.id };
  }

  async addCard(user: ServerAuthUser, boardId: string, body: Body) {
    const board = await this.requireBoard(user, boardId);
    const conversationId = requireUuid(body.conversationId, "conversationId");
    const columnId = requireUuid(body.columnId, "columnId");
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: user.tenantId } });
    if (!conversation || !canView(actorFrom(user), conversation)) throw new HttpError(404, "Conversa não encontrada.");
    const column = await this.prisma.boardColumn.findFirst({ where: { id: columnId, boardId, tenantId: user.tenantId } });
    if (!column) throw new HttpError(422, "Coluna inválida.");
    const last = await this.prisma.boardCard.aggregate({ where: { columnId }, _max: { position: true } });
    try {
      const card = await this.prisma.boardCard.create({
        data: {
          boardId: board.id,
          columnId,
          tenantId: user.tenantId,
          conversationId,
          position: (last._max.position ?? 0) + 1,
        },
      });
      return { id: card.id };
    } catch {
      throw new HttpError(409, "Esta conversa já está neste quadro.");
    }
  }

  async moveCard(user: ServerAuthUser, boardId: string, cardId: string, body: Body) {
    await this.requireBoard(user, boardId);
    const columnId = requireUuid(body.columnId, "columnId");
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 0) throw new HttpError(422, "position inválida.");
    const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;
    const column = await this.prisma.boardColumn.findFirst({ where: { id: columnId, boardId, tenantId: user.tenantId } });
    if (!column) throw new HttpError(422, "Coluna inválida.");
    const result = await this.prisma.boardCard.updateMany({
      where: {
        id: requireUuid(cardId),
        boardId,
        tenantId: user.tenantId,
        ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
      },
      data: { columnId, position, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new HttpError(409, "O cartão foi alterado por outra pessoa. Atualize o quadro.");
    return { ok: true };
  }

  private async requireBoard(user: ServerAuthUser, boardId: string) {
    const board = await this.prisma.conversationBoard.findFirst({
      where: { id: requireUuid(boardId), tenantId: user.tenantId, archivedAt: null },
    });
    if (!board) throw new HttpError(404, "Quadro não encontrado.");
    return board;
  }
}

let singleton: BoardsService | null = null;
export function getBoardsService() {
  singleton ??= new BoardsService();
  return singleton;
}
