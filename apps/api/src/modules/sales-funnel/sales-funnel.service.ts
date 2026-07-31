import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DealPriority, DealStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuthUser } from "../auth/types/auth-user";
import {
  SALES_FUNNEL_PIPELINE_NAME,
  SALES_FUNNEL_STAGES,
  SALES_FUNNEL_STAGE_CODES,
} from "../../../../../shared/sales-funnel.constants";
import { CreateDealDto } from "./dto/create-deal.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { MoveDealDto } from "./dto/move-deal.dto";
import { MarkDealLostDto } from "./dto/mark-deal-lost.dto";
import { ListDealsQueryDto } from "./dto/list-deals-query.dto";

type DealFilters = {
  search?: string;
  stageCode?: string;
  ownerMemberId?: string;
  entrySource?: string;
  clientType?: string;
  contactType?: string;
  city?: string;
  neighborhood?: string;
  priority?: DealPriority;
  includeArchived?: boolean;
  includeLost?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
};

@Injectable()
export class SalesFunnelService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard(user: AuthUser, filters: DealFilters = {}) {
    const pipeline = await this.ensureDefaultPipeline(user.tenantId);
    const where = this.buildDealWhere(user.tenantId, filters);

    const deals = await this.prisma.deal.findMany({
      where: { ...where, pipelineId: pipeline.id },
      orderBy: [{ stageId: "asc" }, { position: "asc" }, { updatedAt: "desc" }],
      include: this.dealInclude(),
    });

    const stages = pipeline.stages.map((stage) => ({
      ...stage,
      deals: deals.filter((deal) => deal.stageId === stage.id),
      count: deals.filter((deal) => deal.stageId === stage.id).length,
    }));

    return {
      pipeline: { id: pipeline.id, name: pipeline.name, isDefault: pipeline.isDefault },
      stages,
    };
  }

  async listDeals(user: AuthUser, query: ListDealsQueryDto) {
    const where = this.buildDealWhere(user.tenantId, {
      ...query,
      createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
      createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    });
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ updatedAt: "desc" }],
        include: this.dealInclude(),
      }),
      this.prisma.deal.count({ where }),
    ]);

    return { items, page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
  }

  async getDeal(user: AuthUser, dealId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId: user.tenantId },
      include: {
        ...this.dealInclude(),
        history: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            actor: {
              select: { id: true, displayName: true, user: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!deal) throw new NotFoundException("Oportunidade não encontrada.");
    return deal;
  }

  async createDeal(user: AuthUser, dto: CreateDealDto) {
    const pipeline = await this.ensureDefaultPipeline(user.tenantId);
    const stage =
      pipeline.stages.find((item) => item.code === dto.stageCode) ?? pipeline.stages[0];
    if (!stage) throw new BadRequestException("Etapa inicial do funil não encontrada.");

    const deal = await this.prisma.deal.create({
      data: {
        tenantId: user.tenantId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: dto.title.trim(),
        phone: this.normalizeOptional(dto.phone),
        email: this.normalizeOptional(dto.email),
        clientType: this.normalizeOptional(dto.clientType),
        entrySource: this.normalizeOptional(dto.entrySource),
        contactType: this.normalizeOptional(dto.contactType),
        city: this.normalizeOptional(dto.city),
        neighborhood: this.normalizeOptional(dto.neighborhood),
        priority: dto.priority ?? DealPriority.MEDIUM,
        valueCents: dto.valueCents ?? 0,
        ownerMemberId: dto.ownerMemberId ?? user.memberId,
        nextAction: this.normalizeOptional(dto.nextAction),
        nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : undefined,
        notes: this.normalizeOptional(dto.notes),
        createdByMemberId: user.memberId,
        updatedByMemberId: user.memberId,
        position: await this.nextPosition(user.tenantId, stage.id),
        status: DealStatus.OPEN,
      },
      include: this.dealInclude(),
    });

    await this.recordHistory({
      tenantId: user.tenantId,
      dealId: deal.id,
      action: "created",
      actorMemberId: user.memberId,
      newValue: { stageCode: stage.code, title: deal.title },
    });
    return deal;
  }

  async updateDeal(user: AuthUser, dealId: string, dto: UpdateDealDto) {
    const existing = await this.requireDeal(user.tenantId, dealId);
    this.assertEditable(existing);
    if (dto.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException(
        "A oportunidade foi alterada por outro usuário. Recarregue e tente novamente.",
      );
    }

    const data: Prisma.DealUpdateInput = {
      updatedByMember: { connect: { id: user.memberId } },
      version: { increment: 1 },
    };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.phone !== undefined) data.phone = this.normalizeOptional(dto.phone);
    if (dto.email !== undefined) data.email = this.normalizeOptional(dto.email);
    if (dto.clientType !== undefined) data.clientType = this.normalizeOptional(dto.clientType);
    if (dto.entrySource !== undefined) data.entrySource = this.normalizeOptional(dto.entrySource);
    if (dto.contactType !== undefined) data.contactType = this.normalizeOptional(dto.contactType);
    if (dto.city !== undefined) data.city = this.normalizeOptional(dto.city);
    if (dto.neighborhood !== undefined) data.neighborhood = this.normalizeOptional(dto.neighborhood);
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.valueCents !== undefined) data.valueCents = dto.valueCents;
    if (dto.nextAction !== undefined) data.nextAction = this.normalizeOptional(dto.nextAction);
    if (dto.nextActionAt !== undefined) {
      data.nextActionAt = dto.nextActionAt ? new Date(dto.nextActionAt) : null;
    }
    if (dto.notes !== undefined) data.notes = this.normalizeOptional(dto.notes);
    if (dto.ownerMemberId !== undefined) {
      data.ownerMember = dto.ownerMemberId
        ? { connect: { id: dto.ownerMemberId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.deal.update({
      where: { id: dealId },
      data,
      include: this.dealInclude(),
    });
    await this.recordHistory({
      tenantId: user.tenantId,
      dealId,
      action: "updated",
      actorMemberId: user.memberId,
    });
    return updated;
  }

  async moveDeal(user: AuthUser, dealId: string, dto: MoveDealDto) {
    const deal = await this.requireDeal(user.tenantId, dealId);
    this.assertEditable(deal);
    if (dto.version !== deal.version) {
      throw new ConflictException(
        "A oportunidade foi alterada por outro usuário. Recarregue e tente novamente.",
      );
    }

    const pipeline = await this.ensureDefaultPipeline(user.tenantId);
    const targetStage = pipeline.stages.find((stage) => stage.id === dto.stageId);
    if (!targetStage) throw new BadRequestException("Etapa de destino inválida.");

    const position = Math.max(0, dto.position ?? 0);
    const previousStageId = deal.stageId;
    const previousPosition = deal.position;
    const activationStage = pipeline.stages.find(
      (stage) => stage.code === SALES_FUNNEL_STAGE_CODES.ATIVACAO,
    );

    await this.prisma.$transaction(async (tx) => {
      if (targetStage.id === previousStageId) {
        await this.reorderWithinStage(tx, user.tenantId, targetStage.id, dealId, position);
      } else {
        await this.reorderAfterRemoval(tx, user.tenantId, previousStageId, dealId, previousPosition);
        await this.makeRoomAtPosition(tx, user.tenantId, targetStage.id, position);
      }

      await tx.deal.update({
        where: { id: dealId },
        data: {
          stageId: targetStage.id,
          position,
          updatedByMemberId: user.memberId,
          version: { increment: 1 },
          status:
            activationStage && targetStage.id === activationStage.id
              ? DealStatus.WON
              : DealStatus.OPEN,
          wonAt:
            activationStage && targetStage.id === activationStage.id ? new Date() : deal.wonAt,
        },
      });
    });

    await this.recordHistory({
      tenantId: user.tenantId,
      dealId,
      action: "stage_changed",
      fieldName: "stageId",
      actorMemberId: user.memberId,
      previousValue: { stageId: previousStageId, position: previousPosition },
      newValue: { stageId: targetStage.id, position, stageCode: targetStage.code },
    });
    return this.getDeal(user, dealId);
  }

  async markLost(user: AuthUser, dealId: string, dto: MarkDealLostDto) {
    const deal = await this.requireDeal(user.tenantId, dealId);
    this.assertEditable(deal);
    if (dto.version !== undefined && dto.version !== deal.version) {
      throw new ConflictException(
        "A oportunidade foi alterada por outro usuário. Recarregue e tente novamente.",
      );
    }
    const lossReason = dto.lossReason.trim();
    if (!lossReason) throw new BadRequestException("Informe o motivo da perda.");

    const updated = await this.prisma.deal.update({
      where: { id: dealId },
      data: {
        status: DealStatus.LOST,
        lossReason,
        lostAt: new Date(),
        lostByMemberId: user.memberId,
        updatedByMemberId: user.memberId,
        version: { increment: 1 },
      },
      include: this.dealInclude(),
    });
    await this.recordHistory({
      tenantId: user.tenantId,
      dealId,
      action: "marked_lost",
      fieldName: "status",
      actorMemberId: user.memberId,
      previousValue: { status: deal.status },
      newValue: { status: DealStatus.LOST, lossReason },
    });
    return updated;
  }

  async archiveDeal(user: AuthUser, dealId: string) {
    const deal = await this.requireDeal(user.tenantId, dealId);
    if (deal.archivedAt) return this.getDeal(user, dealId);

    await this.prisma.deal.update({
      where: { id: dealId },
      data: {
        archivedAt: new Date(),
        archivedByMemberId: user.memberId,
        updatedByMemberId: user.memberId,
        version: { increment: 1 },
      },
    });
    await this.recordHistory({
      tenantId: user.tenantId,
      dealId,
      action: "archived",
      actorMemberId: user.memberId,
    });
    return this.getDeal(user, dealId);
  }

  async restoreDeal(user: AuthUser, dealId: string) {
    const deal = await this.requireDeal(user.tenantId, dealId);
    if (!deal.archivedAt) return this.getDeal(user, dealId);

    await this.prisma.deal.update({
      where: { id: dealId },
      data: {
        archivedAt: null,
        archivedByMemberId: null,
        updatedByMemberId: user.memberId,
        version: { increment: 1 },
      },
    });
    await this.recordHistory({
      tenantId: user.tenantId,
      dealId,
      action: "restored",
      actorMemberId: user.memberId,
    });
    return this.getDeal(user, dealId);
  }

  async listMembers(tenantId: string) {
    return this.prisma.tenantMember.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: {
        id: true,
        displayName: true,
        jobTitle: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ displayName: "asc" }, { user: { name: "asc" } }],
    });
  }

  async ensureDefaultPipeline(tenantId: string) {
    const existing = await this.prisma.pipeline.findFirst({
      where: { tenantId, isDefault: true },
      include: { stages: { orderBy: { position: "asc" } } },
    });

    if (existing && existing.stages.length > 0) {
      await this.ensureStageCodes(existing.id, existing.stages);
      return this.prisma.pipeline.findFirstOrThrow({
        where: { id: existing.id },
        include: { stages: { orderBy: { position: "asc" } } },
      });
    }

    return this.prisma.pipeline.create({
      data: {
        tenantId,
        name: SALES_FUNNEL_PIPELINE_NAME,
        isDefault: true,
        stages: {
          create: SALES_FUNNEL_STAGES.map((stage) => ({
            tenantId,
            name: stage.name,
            code: stage.code,
            position: stage.position,
            color: stage.color,
          })),
        },
      },
      include: { stages: { orderBy: { position: "asc" } } },
    });
  }

  private async ensureStageCodes(
    pipelineId: string,
    stages: Array<{ id: string; code: string | null; name: string; position: number }>,
  ) {
    for (const definition of SALES_FUNNEL_STAGES) {
      const stage =
        stages.find((item) => item.code === definition.code) ??
        stages.find((item) => item.name === definition.name);
      if (stage && !stage.code) {
        await this.prisma.pipelineStage.update({
          where: { id: stage.id },
          data: { code: definition.code, color: definition.color },
        });
      }
    }
  }

  private buildDealWhere(tenantId: string, filters: DealFilters): Prisma.DealWhereInput {
    const where: Prisma.DealWhereInput = {
      tenantId,
      archivedAt: filters.includeArchived ? undefined : null,
      status: filters.includeLost ? undefined : { not: DealStatus.LOST },
    };
    if (filters.search?.trim()) {
      const search = filters.search.trim();
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { neighborhood: { contains: search, mode: "insensitive" } },
      ];
    }
    if (filters.stageCode) where.stage = { code: filters.stageCode };
    if (filters.ownerMemberId) where.ownerMemberId = filters.ownerMemberId;
    if (filters.entrySource) where.entrySource = filters.entrySource;
    if (filters.clientType) where.clientType = filters.clientType;
    if (filters.contactType) where.contactType = filters.contactType;
    if (filters.city) where.city = filters.city;
    if (filters.neighborhood) where.neighborhood = filters.neighborhood;
    if (filters.priority) where.priority = filters.priority;
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {
        ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
        ...(filters.createdTo ? { lte: filters.createdTo } : {}),
      };
    }
    return where;
  }

  private dealInclude() {
    return {
      stage: { select: { id: true, name: true, code: true, color: true, position: true } },
      ownerMember: {
        select: { id: true, displayName: true, user: { select: { name: true } } },
      },
    } satisfies Prisma.DealInclude;
  }

  private async requireDeal(tenantId: string, dealId: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId, tenantId } });
    if (!deal) throw new NotFoundException("Oportunidade não encontrada.");
    return deal;
  }

  private assertEditable(deal: { archivedAt: Date | null; status: DealStatus }) {
    if (deal.archivedAt) {
      throw new ForbiddenException("Oportunidade arquivada não pode ser alterada.");
    }
    if (deal.status === DealStatus.LOST) {
      throw new ForbiddenException("Oportunidade perdida não pode ser alterada.");
    }
  }

  private normalizeOptional(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private async nextPosition(tenantId: string, stageId: string) {
    const last = await this.prisma.deal.findFirst({
      where: { tenantId, stageId, archivedAt: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private async reorderWithinStage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    stageId: string,
    dealId: string,
    targetPosition: number,
  ) {
    const siblings = await tx.deal.findMany({
      where: { tenantId, stageId, archivedAt: null, id: { not: dealId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const orderedIds = siblings.map((item) => item.id);
    orderedIds.splice(Math.min(targetPosition, orderedIds.length), 0, dealId);
    await Promise.all(
      orderedIds.map((id, index) => tx.deal.update({ where: { id }, data: { position: index } })),
    );
  }

  private async reorderAfterRemoval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    stageId: string,
    dealId: string,
    removedPosition: number,
  ) {
    await tx.deal.updateMany({
      where: {
        tenantId,
        stageId,
        archivedAt: null,
        id: { not: dealId },
        position: { gt: removedPosition },
      },
      data: { position: { decrement: 1 } },
    });
  }

  private async makeRoomAtPosition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    stageId: string,
    targetPosition: number,
  ) {
    await tx.deal.updateMany({
      where: { tenantId, stageId, archivedAt: null, position: { gte: targetPosition } },
      data: { position: { increment: 1 } },
    });
  }

  private async recordHistory(input: {
    tenantId: string;
    dealId: string;
    action: string;
    fieldName?: string;
    actorMemberId?: string;
    previousValue?: unknown;
    newValue?: unknown;
  }) {
    await this.prisma.dealHistory.create({
      data: {
        tenantId: input.tenantId,
        dealId: input.dealId,
        action: input.action,
        fieldName: input.fieldName,
        actorMemberId: input.actorMemberId,
        previousValue: input.previousValue as Prisma.InputJsonValue | undefined,
        newValue: input.newValue as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
