# Resumo Técnico — micro-services-ts

**Data de referência:** 2026-07-01
**Escopo:** dois microsserviços NestJS independentes, cada um em seu próprio repositório Git. Este documento vive no repositório `microservice-cyberalert` por conveniência (workspace de referência), mas descreve ambos os serviços igualmente — caminhos de arquivo prefixados com `microservice-nest/profile-service/` referem-se ao repositório irmão, no mesmo diretório pai.

| Repositório | Serviço | Porta | Protocolo | Papel |
|---|---|---|---|---|
| `microservice-cyberalert` | Threat Triage & Alerts Engine | 3001 | REST + Worker assíncrono | Consome eventos de ameaça, pontua severidade, persiste, aciona bloqueio de IP |
| `microservice-nest/profile-service` | Profile Service | 3000 | GraphQL + Worker assíncrono | CRUD de perfis de usuário com indexação de busca assíncrona |

Os dois serviços são **desacoplados**: não há chamada direta entre eles, cada um tem seu próprio Postgres, seu próprio LocalStack (SNS/SQS) e (no caso do Profile Service) seu próprio OpenSearch. Compartilham apenas o mesmo padrão arquitetural (NestJS + AWS messaging + Postgres) e coexistem em portas distintas para rodar simultaneamente em desenvolvimento local.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         micro-services-ts (workspace)                      │
│                                                                             │
│  ┌───────────────────────────┐         ┌────────────────────────────────┐ │
│  │ microservice-cyberalert     │         │ microservice-nest/profile-service│ │
│  │ Threat Triage Engine        │         │ Profile Service                  │ │
│  │ REST :3001 + Worker SQS     │         │ GraphQL :3000 + Worker SQS       │ │
│  └──────────────┬──────────────┘         └───────────────┬──────────────────┘ │
│                 │                                         │                  │
│      ┌──────────┼──────────┐                 ┌────────────┼────────────┐     │
│      ▼          ▼                              ▼            ▼            ▼     │
│  Postgres   LocalStack (SNS/SQS)            Postgres   LocalStack(SNS/SQS) OpenSearch│
│  :5432      :4566                            :5433      :4567             :9200 │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Threat Triage & Alerts Engine (`microservice-cyberalert`)

### 1.1 Propósito
Worker orientado a eventos que consome alertas brutos de detecção (`threat-detected`), calcula uma pontuação de severidade determinística e auditável, persiste a inteligência consolidada e — para ameaças críticas — emite um comando de bloqueio de IP (`block-ip-command`) para outro sistema consumir.

### 1.2 Stack
NestJS 10 · TypeORM 0.3 · PostgreSQL 16 · AWS SDK v3 (SNS/SQS) · class-validator/class-transformer · Swagger (`@nestjs/swagger`) · Terminus (health checks) · Jest + Supertest.

### 1.3 Arquitetura em camadas

```
┌──────────────────────────────────────────────────────────┐
│ Presentation   ThreatsController (REST) · HealthController │  → Swagger em /api/docs
├──────────────────────────────────────────────────────────┤
│ Domínio/Regra  SeverityAnalyzer · ThreatTriageService       │  → lógica de negócio pura
├──────────────────────────────────────────────────────────┤
│ Worker         ThreatConsumerService (long-poll SQS)         │  → ciclo de vida via lifecycle hooks Nest
├──────────────────────────────────────────────────────────┤
│ Infraestrutura TypeORM Repository<Threat> · SnsPublisherService│
└──────────────────────────────────────────────────────────┘
```
Não é Clean Architecture estrita (não há portas/interfaces isolando domínio de infra — o `ThreatTriageService` injeta o `Repository<Threat>` do TypeORM diretamente). É uma arquitetura modular NestJS convencional, adequada ao tamanho do serviço; o `SeverityAnalyzer`, porém, é mantido puro (sem I/O), o que o torna 100% testável isoladamente.

**Referências de código:** `src/threats/threat-triage.service.ts`, `src/threats/domain/severity-analyzer.ts`, `src/threats/threats.controller.ts`, `src/threats/threat-consumer.service.ts`.

### 1.4 Modelo de dados — tabela `threats`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid (PK) | gerado |
| `threatId` | uuid, **unique** + index | id de negócio do evento original — garante idempotência em reentregas do SQS (at-least-once) |
| `source`, `sourceIp` (indexado), `category` (enum) | — | origem do evento |
| `signature` | varchar nullable | assinatura textual da ameaça |
| `severity` (enum, indexado) | LOW/MEDIUM/HIGH/CRITICAL | resultado da triagem |
| `score` | int 0–100 | pontuação combinada |
| `cvssScore`, `confidence` | real nullable | fatores de entrada |
| `indicators` | jsonb | IOCs |
| `scoreBreakdown` | jsonb | contribuição de cada fator (auditabilidade) |
| `blockCommandIssued` | boolean | se um `block-ip-command` foi emitido |
| `detectedAt`, `createdAt`, `updatedAt` | timestamptz | — |

Referência: `src/threats/entities/threat.entity.ts`.

### 1.5 Fluxo de dados — caminho de escrita (assíncrono, event-driven)

```
 [Scanner/EDR externo]
        │ 1. SNS Publish "threat-detected" (JSON)
        ▼
 ┌─────────────────────┐
 │ SNS topic             │
 │ threat-detected        │
 └─────────┬─────────────┘
        │ 2. fan-out, RawMessageDelivery=true
        ▼
 ┌─────────────────────────┐     falha 5x (maxReceiveCount)
 │ SQS: threat-analysis-queue│──────────────────────────────▶ DLQ threat-analysis-dlq
 └─────────┬─────────────────┘     (auditoria, sem perda silenciosa de dado)
        │ 3. long-poll (WaitTimeSeconds=20s, até 10 msgs/lote)
        ▼
 ┌────────────────────────────────┐
 │ ThreatConsumerService (worker)    │  onApplicationBootstrap → start()
 │  • unwrapSnsMessage()              │
 │  • plainToInstance + validateOrReject│──✗ inválido──▶ mensagem NÃO é deletada (permanece para retry/DLQ)
 └─────────┬──────────────────────────┘
        │ 4. dto válido
        ▼
 ┌────────────────────────────────┐
 │ ThreatTriageService               │
 │  • idempotência: findOne(threatId) → upsert em vez de duplicar│
 │  • SeverityAnalyzer.analyze(evento) → score + severity + breakdown│
 │  • persiste Threat                  │
 └─────────┬──────────────────────────┘
        │ 5. save (Postgres)
        ▼
   PostgreSQL: tabela `threats`
        │
        │ 6. SE severity == CRITICAL
        ▼
 ┌─────────────────────┐
 │ SNS topic block-ip-command│ ──▶ consumido por sistema externo (fora deste repo)
 └─────────────────────┘

 [Dashboard/Auditoria] ──7. GET /threats , GET /threats/:id──▶ ThreatsController ──▶ Postgres (leitura síncrona)
```

### 1.6 Algoritmo de pontuação (fluxograma)

Modelo de soma ponderada, determinístico e auditável (`src/threats/domain/severity-analyzer.ts`):

```
entrada: cvssScore (0-10), category (enum), confidence (0-1), indicators[]

cvss        = clamp(cvssScore / 10, 0, 1)              × peso 0.50
category    = CATEGORY_WEIGHT[category]                 × peso 0.30
confidence  = clamp(confidence, 0, 1)                    × peso 0.20
indicatorBoost = min(nº_indicadores × 0.05, 0.20)         (bônus adicional, fora da soma base)

combined = clamp(cvss·0.5 + category·0.3 + confidence·0.2 + indicatorBoost, 0, 1)
score    = round(combined × 100)     // 0–100, com breakdown por fator persistido em scoreBreakdown
```

Pesos de categoria (`CATEGORY_WEIGHT`):

| Categoria | Peso |
|---|---|
| exfiltration | 1.00 |
| intrusion | 0.95 |
| malware | 0.90 |
| ddos | 0.75 |
| vulnerability | 0.60 |
| unknown | 0.50 |
| recon | 0.40 |
| policy_violation | 0.30 |

Faixas de severidade (limite inferior inclusivo):

| Score | Severidade | Ação |
|---|---|---|
| ≥ 85 | **CRITICAL** | emite `block-ip-command` |
| ≥ 60 | HIGH | persiste apenas |
| ≥ 35 | MEDIUM | persiste apenas |
| ≥ 0 | LOW | persiste apenas |

### 1.7 API REST

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/threats` | lista, filtros `severity`, `sourceIp`, `limit` (default 50), ordenado por `detectedAt` desc |
| `GET` | `/threats/:threatId` | busca por id de negócio (UUID) — retorna `null`/200 se não encontrado, `400` se UUID inválido |
| `GET` | `/health` | Terminus, ping no Postgres |
| `GET` | `/api/docs` | Swagger UI |

### 1.8 Mensageria (topologia LocalStack)

| Recurso | Nome | Config |
|---|---|---|
| SNS topic | `threat-detected` | entrada de eventos |
| SNS topic | `block-ip-command` | saída para sistema de bloqueio |
| SQS queue | `threat-analysis-queue` | `VisibilityTimeout=60s`, assinante do topic acima (raw delivery) |
| SQS DLQ | `threat-analysis-dlq` | `maxReceiveCount=5` |

Provisionado automaticamente por `scripts/localstack-init.sh` no boot do container.

### 1.9 Padrões de projeto identificados
- **Idempotent consumer** (`findOne(threatId)` antes de persistir — reentregas SQS não duplicam).
- **Dead-letter routing** (falha de validação/processamento não deleta a mensagem → redrive automático).
- **Weighted-sum scoring model** — estratégia determinística e explicável em vez de heurísticas opaias.
- **DTO + class-validator** na borda de entrada (mensagens SQS) e de saída (Swagger).
- **Repository pattern** via `@InjectRepository(Threat)` do TypeORM.
- **Application lifecycle hooks** (`OnApplicationBootstrap`/`OnApplicationShutdown`) para start/stop gracioso do worker.

---

## 2. Profile Service (`microservice-nest/profile-service`)

### 2.1 Propósito
Microsserviço de perfis de usuário com **CQRS**: escrita forte-consistente em Postgres via GraphQL, leitura/busca full-text eventual-consistente via OpenSearch, sincronizadas por **Transactional Outbox** + SNS/SQS.

### 2.2 Stack
NestJS 10 · GraphQL (Apollo, code-first) · Prisma 6 · PostgreSQL 16 · OpenSearch 2.19 · AWS SDK v3 (SNS FIFO/SQS) · `@nestjs/schedule` (cron do outbox poller) · Swagger (para o endpoint REST de health) · Jest (projetos unit/integration/e2e) + Supertest.

### 2.3 Clean / Hexagonal Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Presentation    ProfileResolver (GraphQL) · HealthController (REST)   │
│                 DomainExceptionFilter (mapeia erro de domínio → GraphQLError)│
├────────────────────────────────────────────────────────────────────┤
│ Application     5 Use Cases: Create/Update/Delete/GetById/SearchProfiles│
│                 Porta: Clock (testabilidade determinística)             │
├────────────────────────────────────────────────────────────────────┤
│ Domain (núcleo) UserProfile (entidade rica) · Value Objects (Username,  │
│                 Email, DisplayName) · Domain Events · Portas            │
│                 (UserProfileRepository, ProfileSearchRepository,        │
│                 OutboxRepository, EventPublisher) — SEM dependências de │
│                 infraestrutura                                          │
├────────────────────────────────────────────────────────────────────┤
│ Infrastructure  Prisma (Postgres) · OpenSearch client · AWS SNS/SQS     │
│                 → implementam as portas definidas no domínio            │
└────────────────────────────────────────────────────────────────────┘
        Regra de dependência: as camadas de fora dependem de dentro;
        o domínio nunca importa Prisma, OpenSearch ou AWS SDK.
```

Decisões formais documentadas em ADRs (`profile-service/docs/adr/`):
- **ADR-001** — Transactional Outbox em vez de dual-write direto.
- **ADR-002** — CQRS: Postgres (escrita) + OpenSearch (leitura/busca).
- **ADR-003** — Indexação idempotente e version-aware (protege contra entrega fora de ordem do SQS).
- **ADR-004** — Prisma como ORM do lado de escrita.
- **ADR-005** — GraphQL code-first com contrato SDL revisável.

### 2.4 Modelo de dados

**`user_profiles`** (Prisma, Postgres):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `username` | string, **unique** | mutado no soft-delete (ver §2.7) |
| `email` | string, **unique** | idem |
| `displayName` | string | |
| `avatarUrl` | string? | |
| `status` | enum `ACTIVE\|INACTIVE\|SUSPENDED` | `INACTIVE` também representa "excluído" |
| `version` | int | **lock otimista** |
| `createdAt`/`updatedAt` | timestamp | |

**`outbox_events`** (padrão Transactional Outbox):

| Coluna | Tipo |
|---|---|
| `id`, `aggregateId`, `type`, `payload` (json), `version` | — |
| `status` | `PENDING\|PUBLISHED\|FAILED` |
| `createdAt`, `publishedAt` | — |

Referência: `prisma/schema.prisma`.

### 2.5 Fluxo de escrita — Transactional Outbox (fluxograma)

```
GraphQL mutation (createProfile / updateProfile / deleteProfile)
        │
        ▼
 ProfileResolver ──▶ UseCase correspondente
        │
        ▼
 UserProfile (entidade de domínio)
   • valida via Value Objects (Username/Email/DisplayName)
   • aplica regra de negócio (ex.: delete() muda status→INACTIVE)
   • registra Domain Event (ProfileCreated/Updated/Deleted)
        │
        ▼
 UserProfileRepository.save(profile, events)
        │            ┌── MESMA TRANSAÇÃO Prisma ($transaction) ──┐
        ├────────────▶│ UPSERT user_profiles                       │
        └────────────▶│ INSERT outbox_events (status=PENDING)      │
                       └──────────────── commit atômico ────────────┘

 OutboxPollerService  (@Cron EVERY_10_SECONDS)
        │
        ├─ SELECT outbox_events WHERE status=PENDING LIMIT 50
        ├─ publish(evento) ──▶ SNS FIFO topic `profile-events.fifo`
        └─ UPDATE status=PUBLISHED  (ou FAILED → retry no próximo ciclo)

 SNS FIFO ──fan-out──▶ SQS `profile-index-queue`
        │
        ▼
 SqsProfileIndexConsumerService (worker dedicado, long-poll)
        │
        ▼
 ProfileIndexConsumer ──▶ OpenSearchProfileRepository
        │
        └─ indexação idempotente e version-aware (ADR-003):
           só sobrescreve se versão_recebida > versão_indexada
```

**Por que outbox e não dual-write direto?** Se o serviço escrevesse no Postgres e publicasse no SNS como duas operações separadas, uma falha entre elas deixaria o índice de busca desatualizado silenciosamente. O outbox garante que o evento só existe se a transação de negócio committou (ADR-001).

### 2.6 Fluxo de leitura

```
GraphQL query profile(id)        → GetProfileByIdUseCase  → PrismaUserProfileRepository → Postgres
                                    (fonte de verdade, consistência FORTE)

GraphQL query searchProfiles(q)  → SearchProfilesUseCase  → OpenSearchProfileRepository  → OpenSearch
                                    (full-text/paginação, consistência EVENTUAL — atraso típico ~10s,
                                     limitado pelo intervalo do outbox poller)
```

### 2.7 Mecanismo específico: soft-delete com liberação de username/email

Ponto de design não óbvio, verificado em `src/infrastructure/persistence/profile.mapper.ts`:

- `UserProfile.delete()` marca `status = INACTIVE` e incrementa `version` — a linha nunca é fisicamente apagada (auditoria).
- Como `username`/`email` têm constraint **unique** no banco, um simples soft-delete bloquearia o reuso do mesmo username por outro usuário.
- Solução: ao persistir um perfil deletado, `toPersistedUsername()`/`toPersistedEmail()` **reescrevem** essas colunas para valores sintéticos e não colidentes (`del_<uuid-sem-hifens>` / `deleted+<id>@released.invalid`), liberando o username/email original para reuso imediato.
- `existsByUsername()` filtra `status != INACTIVE`, então a checagem de conflito nunca considera linhas soft-deletadas.

Isso foi corrigido em um commit específico da branch (`fix(profile): hide soft-deleted profiles and allow username reuse`) e **validado em produção real** na sessão anterior: criar → deletar → recriar com o mesmo username funcionou de ponta a ponta.

### 2.8 Contrato de erros GraphQL

`DomainExceptionFilter` (`src/presentation/graphql/domain-exception.filter.ts`) mapeia exceções de domínio para `extensions` do GraphQL:

| `DomainErrorCode` | `extensions.code` | HTTP equivalente | Cenário |
|---|---|---|---|
| `VALIDATION` | `BAD_USER_INPUT` | 400 | Value Object rejeita entrada (ex.: email malformado) |
| `CONFLICT` | `CONFLICT` | 409 | username/email já em uso |
| `NOT_FOUND` | `NOT_FOUND` | 404 | perfil inexistente |
| `VERSION_CONFLICT` | `PRECONDITION_FAILED` | 412 | lock otimista — `version` enviada não bate com a atual |

Todos os quatro foram exercitados manualmente contra a aplicação real na sessão anterior e bateram exatamente com esta tabela.

### 2.9 API GraphQL

| Operação | Tipo | Descrição |
|---|---|---|
| `profile(id)` | Query | busca por id, `null` se não encontrado |
| `searchProfiles(query, status, limit, offset)` | Query | busca full-text via OpenSearch, paginada |
| `createProfile(input)` | Mutation | cria (username/email/displayName/avatarUrl?) |
| `updateProfile(input)` | Mutation | requer `id` + `version` (lock otimista) |
| `deleteProfile(id)` | Mutation | soft-delete, retorna boolean |
| `GET /health` | REST | Terminus-style, ping Postgres |
| `GET /api/docs` | REST | Swagger UI (documenta o endpoint de health; operações de negócio ficam no schema GraphQL em `/graphql`) |

### 2.10 Mensageria (topologia LocalStack)

| Recurso | Nome | Observação |
|---|---|---|
| SNS topic | `profile-events.fifo` | FIFO — preserva ordem por `aggregateId` |
| SQS queue | `profile-index-queue` | consumida pelo `SqsProfileIndexConsumerService` |

### 2.11 Padrões de projeto identificados
- **Hexagonal/Ports & Adapters** — domínio define interfaces, infraestrutura implementa.
- **Transactional Outbox** (ADR-001).
- **CQRS** — modelo de escrita (Postgres) separado do modelo de leitura (OpenSearch) (ADR-002).
- **Optimistic locking** via campo `version`.
- **Idempotent, version-aware projection** — indexador ignora eventos atrasados/fora de ordem (ADR-003).
- **Value Objects** (Username/Email/DisplayName) — validação encapsulada, imutável.
- **Domain Events** coletados na entidade e publicados só após commit.
- **Rich Domain Model** — regras de negócio na entidade (`delete()`, `update()`), não em services anêmicos.

---

## 3. Infraestrutura local (Docker Compose)

| Stack | Serviço | Imagem | Porta host | Propósito |
|---|---|---|---|---|
| cyberalert | postgres | `postgres:16-alpine` | 5432 | dados de ameaças |
| cyberalert | localstack | `localstack:4.4.0` | 4566 | SNS/SQS |
| profile-service | postgres | `postgres:16-alpine` | 5433 | perfis + outbox |
| profile-service | localstack | `localstack:4.4.0` | 4567 | SNS/SQS |
| profile-service | opensearch | `opensearch:2.19.0` | 9200 | índice de busca |

Portas escolhidas deliberadamente para **coexistência** (commit `chore(infra): configure coexistence ports`) — os dois stacks rodam simultaneamente sem conflito.

**Footprint observado (docker stats, ambiente ocioso):**

| Container | CPU | Memória |
|---|---|---|
| threat-postgres | ~0% | 42 MiB |
| threat-localstack | ~0% | 220 MiB |
| profile-service-postgres | ~0% | 26 MiB |
| profile-service-localstack | ~0% | 148 MiB |
| profile-service-opensearch | ~12% (JVM warmup) | 1.15 GiB |

---

## 4. Qualidade, testes e cobertura

### 4.1 Pirâmide de testes

| Serviço | Unit | Integration | E2E | Total |
|---|---|---|---|---|
| cyberalert | ~63 | — (unit cobre repositórios mockados) | 7 | **70 testes** |
| profile-service | ~90 | ~25 | 14 | **129 testes** |

### 4.2 Cobertura de código (jest --coverage, gate `coverageThreshold`)

| Serviço | Statements | Branches | Functions | Lines | Threshold configurado |
|---|---|---|---|---|---|
| cyberalert | **95.53%** | 94.94% | 93.02% | 95.79% | 90/80/90/90 |
| profile-service | **100%** | 96.36% | **100%** | **100%** | 90/80/90/90 |

Ambos os limites são **enforced** — o comando `test:cov` falha o processo (exit code ≠ 0) se qualquer métrica cair abaixo do configurado em `package.json`/`jest.config.js`, o que os torna um gate real de CI, não apenas um número decorativo.

### 4.3 Lint / Build
Ambos os repositórios: `eslint` limpo (0 erros), `nest build` limpo, TypeScript estrito.

### 4.4 Verificação funcional real (não só testes automatizados)
Na sessão anterior, os dois serviços foram **efetivamente subidos** (Docker + `node dist/main.js`) e exercitados com tráfego real via `curl`/AWS CLI contra o LocalStack — não apenas mocks de teste:

- **cyberalert:** publicação real de evento CRITICAL via SNS → triagem → `score=100` → `block-ip-command` emitido; evento LOW → persistido sem block-command; mensagem com enum inválido → rejeitada e mantida na fila para DLQ (comportamento de auditoria confirmado, não simulado).
- **profile-service:** `createProfile` → `409 CONFLICT` em username duplicado → `400 BAD_USER_INPUT` em email inválido → `updateProfile` com sucesso → `412 PRECONDITION_FAILED` com versão desatualizada → pipeline assíncrono completo (outbox → SNS → SQS → OpenSearch) confirmado via `searchProfiles` retornando o dado já atualizado → `deleteProfile` → busca não retorna mais o perfil → **reuso de username após delete confirmado em produção real**.

---

## 5. Métricas de código

| Métrica | cyberalert | profile-service |
|---|---|---|
| Arquivos de produção (`src/**/*.ts`) | 23 | 37 |
| Arquivos de teste | 13 | 32 |
| LOC produção | ~1.184 | ~1.935 |
| LOC teste | ~1.077 | ~2.296 |
| Razão teste:produção (LOC) | ~0.91:1 | ~1.19:1 |
| Dependências de runtime | 16 | 16 |
| Dependências de dev | 21 | 19 |

### Dependências principais (runtime)

| cyberalert | profile-service |
|---|---|
| `@nestjs/{common,core,config,platform-express,swagger,terminus,typeorm}` | `@nestjs/{common,core,platform-express,swagger,apollo,graphql,schedule}` |
| `@aws-sdk/{client-sns,client-sqs}` | `@aws-sdk/{client-sns,client-sqs}` |
| `typeorm` + `pg` | `@prisma/client` |
| `class-validator`/`class-transformer` | `@opensearch-project/opensearch` |
| — | `graphql` + `apollo-server-express` |

---

## 6. Git, commits e PRs

Convenção: **Conventional Commits**, branches de feature próprias, PRs abertos contra `main`.

| Repositório | Branch | PR | Status |
|---|---|---|---|
| microservice-cyberalert | `feat/swagger-postman-and-infra` | [#2](https://github.com/atoussec-ctrl/microservice-cyberalert/pull/2) | aberto, 7 commits |
| microservice-nest | `feat/profile-service-hardening-and-docs` | [#4](https://github.com/atoussec-ctrl/microservice-nest/pull/4) | aberto, commits de hardening + coverage |

Trabalho realizado nesta iniciativa (resumo):
1. Auditoria completa (lint/build/testes/cobertura/Swagger/Postman) nos dois serviços.
2. Correção de ~1550 erros de lint (CRLF) no cyberalert — cosmético, zero mudança de comportamento.
3. Elevação de cobertura: cyberalert 52%→95.5%, profile-service 86%→100% (statements).
4. Criação da suíte e2e do cyberalert (inexistente antes).
5. Identificação e correção de um **bug real de teste** (não de produção): um teste do consumidor SQS do profile-service girava um loop de polling sem limite sob `jest.useFakeTimers()`, derrubando o worker do Jest por estouro de memória (~4GB) — corrigido para terminar deterministicamente.
6. Limpeza de um artefato de runtime não rastreado (`scripts/sample-threat.json`, gerado dinamicamente pelo script PowerShell) — adicionado ao `.gitignore` em vez de commitado.
7. Subida real dos dois stacks via Docker Compose e validação funcional ponta a ponta contra as aplicações rodando de verdade.

---

## 7. Referências rápidas (arquivo → assunto)

| Assunto | Arquivo |
|---|---|
| Algoritmo de severidade | `microservice-cyberalert/src/threats/domain/severity-analyzer.ts` |
| Worker SQS (threats) | `microservice-cyberalert/src/threats/threat-consumer.service.ts` |
| Entidade Threat (schema) | `microservice-cyberalert/src/threats/entities/threat.entity.ts` |
| Swagger setup | `microservice-cyberalert/src/swagger.ts`, `microservice-nest/profile-service/src/swagger.ts` |
| Postman collections | `microservice-cyberalert/docs/postman/`, `microservice-nest/docs/postman/` |
| Entidade de domínio UserProfile | `microservice-nest/profile-service/src/domain/entities/user-profile.entity.ts` |
| Outbox poller | `microservice-nest/profile-service/src/infrastructure/messaging/outbox-poller.service.ts` |
| Worker SQS (index) | `microservice-nest/profile-service/src/infrastructure/messaging/sqs-profile-index.consumer.service.ts` |
| Mapper de persistência (soft-delete) | `microservice-nest/profile-service/src/infrastructure/persistence/profile.mapper.ts` |
| Filtro de exceções GraphQL | `microservice-nest/profile-service/src/presentation/graphql/domain-exception.filter.ts` |
| ADRs (decisões arquiteturais) | `microservice-nest/profile-service/docs/adr/ADR-00{1..5}-*.md` |
| Arquitetura detalhada (profile-service) | `microservice-nest/profile-service/docs/ARCHITECTURE.md` |
| Schema Prisma | `microservice-nest/profile-service/prisma/schema.prisma` |
| Docker Compose | `*/docker-compose.yml` |
