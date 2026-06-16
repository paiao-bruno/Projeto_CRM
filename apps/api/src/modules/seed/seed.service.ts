import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hash } from "bcryptjs";
import { PrismaService } from "../database/prisma.service";

const PERMISSIONS = [
  "dashboard.read",
  "chat.read",
  "chat.reply",
  "chat.transfer",
  "ai_agents.manage",
  "crm.manage",
  "customers.manage",
];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>("AUTO_SEED_DEMO", "true") === "false") {
      return;
    }

    await this.seedDemoData();
  }

  private async seedDemoData() {
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: "fibra-plus" },
      update: {},
      create: {
        name: "Fibra Plus ISP",
        slug: "fibra-plus",
        document: "00.000.000/0001-00",
        status: "ACTIVE",
        settings: {
          timezone: "America/Sao_Paulo",
          locale: "pt-BR",
        },
      },
    });

    const permissions = await Promise.all(
      PERMISSIONS.map((code) =>
        this.prisma.permission.upsert({
          where: { code },
          update: {},
          create: { code, description: code },
        }),
      ),
    );

    const role = await this.prisma.role.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Administrador",
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Administrador",
        description: "Acesso administrativo ao CRM",
        scope: "TENANT",
      },
    });

    await this.prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });

    const passwordHash = await hash("admin123", 10);
    const user = await this.prisma.user.upsert({
      where: { email: "admin@ispcrm.local" },
      update: {},
      create: {
        email: "admin@ispcrm.local",
        name: "Admin ISP",
        passwordHash,
        status: "ACTIVE",
      },
    });

    const member = await this.prisma.tenantMember.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: {
        roleId: role.id,
        status: "ACTIVE",
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        roleId: role.id,
        displayName: "Admin ISP",
        jobTitle: "Gestor de Atendimento",
        status: "ACTIVE",
      },
    });

    const customerCount = await this.prisma.customer.count({
      where: { tenantId: tenant.id },
    });

    if (customerCount === 0) {
      await this.prisma.customer.createMany({
        data: [
          {
            tenantId: tenant.id,
            ownerMemberId: member.id,
            name: "Mariana Costa",
            document: "123.456.789-10",
            email: "mariana@example.com",
            phone: "+5511999990001",
            status: "ACTIVE",
            planName: "Fibra 600 Mega",
            address: { city: "Sao Paulo", state: "SP" },
          },
          {
            tenantId: tenant.id,
            ownerMemberId: member.id,
            name: "Rafael Almeida",
            document: "987.654.321-00",
            email: "rafael@example.com",
            phone: "+5511999990002",
            status: "PROSPECT",
            planName: "Fibra 1 Giga",
            address: { city: "Campinas", state: "SP" },
          },
          {
            tenantId: tenant.id,
            ownerMemberId: member.id,
            name: "Condominio Jardim Norte",
            document: "11.222.333/0001-44",
            email: "sindico@jardimnorte.example",
            phone: "+5511999990003",
            status: "OVERDUE",
            planName: "Link Dedicado 2 Gbps",
            address: { city: "Guarulhos", state: "SP" },
          },
        ],
      });
    }

    const aiAgent = await this.prisma.aiAgent.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Nina Suporte",
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Nina Suporte",
        description: "Agente para triagem de suporte tecnico e financeiro.",
        provider: "OPENAI",
        model: "gpt-4.1-mini",
        systemPrompt:
          "Voce e uma assistente de suporte de um provedor de internet. Seja objetiva, cordial e colete dados do assinante antes de orientar.",
        temperature: "0.30",
        maxTokens: 800,
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await this.prisma.aiAgent.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Leo Vendas",
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Leo Vendas",
        description: "Agente focado em qualificacao de leads e planos fibra.",
        provider: "CLAUDE",
        model: "claude-3-5-sonnet",
        systemPrompt:
          "Qualifique interessados em planos de fibra, identifique endereco, velocidade desejada e urgencia de instalacao.",
        temperature: "0.45",
        maxTokens: 1000,
        status: "INACTIVE",
      },
    });

    const existingConversation = await this.prisma.conversation.findFirst({
      where: { tenantId: tenant.id },
    });

    if (!existingConversation) {
      const customer = await this.prisma.customer.findFirstOrThrow({
        where: { tenantId: tenant.id, phone: "+5511999990001" },
      });

      const conversation = await this.prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          assignedMemberId: member.id,
          activeAiAgentId: aiAgent.id,
          subject: "Instabilidade no bairro",
          status: "OPEN",
          priority: "HIGH",
          lastMessageAt: new Date(),
        },
      });

      await this.prisma.message.createMany({
        data: [
          {
            tenantId: tenant.id,
            conversationId: conversation.id,
            senderType: "CUSTOMER",
            direction: "INBOUND",
            contentType: "TEXT",
            senderCustomerId: customer.id,
            body: "Minha internet esta oscilando desde cedo. Podem verificar?",
            createdAt: new Date(Date.now() - 1000 * 60 * 8),
          },
          {
            tenantId: tenant.id,
            conversationId: conversation.id,
            senderType: "AI_AGENT",
            direction: "OUTBOUND",
            contentType: "TEXT",
            senderAiAgentId: aiAgent.id,
            body: "Oi, Mariana. Vou verificar a sua regiao e abrir um diagnostico inicial.",
            createdAt: new Date(Date.now() - 1000 * 60 * 6),
          },
          {
            tenantId: tenant.id,
            conversationId: conversation.id,
            senderType: "USER",
            direction: "OUTBOUND",
            contentType: "TEXT",
            senderMemberId: member.id,
            body: "Mariana, identificamos manutencao na rota. Previsao de normalizacao em breve.",
            createdAt: new Date(Date.now() - 1000 * 60 * 3),
          },
        ],
      });
    }

    this.logger.log("Demo data ready: admin@ispcrm.local / admin123");
  }
}
