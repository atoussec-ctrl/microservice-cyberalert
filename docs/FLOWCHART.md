# Fluxograma da Aplicação — Threat Triage & Alerts Engine

**Repositório:** `microservice-cyberalert` · **Porta:** 3001 · **Protocolo:** REST (leitura) + Worker SQS (escrita)

Este documento descreve a aplicação inteira através de diagramas UML (componentes, classes,
sequência, atividades e estados), cada um seguido de uma explicação do **porquê** da decisão de
design — não apenas do "o quê". Os diagramas usam a sintaxe [Mermaid](https://mermaid.js.org/),
renderizada nativamente pelo GitHub/GitLab; a notação segue UML 2.x (setas de composição/agregação,
`<<interface>>`, guardas `[condição]`, etc.).

---

## 1. Diagrama de componentes — arquitetura em camadas

```mermaid
flowchart TB
    subgraph EXT["Sistemas externos"]
        SCANNER["Scanner / EDR\n(publica threat-detected)"]
        BLOCKER["Sistema de bloqueio de IP\n(consome block-ip-command)"]
    end

    subgraph AWS["AWS / LocalStack — mensageria"]
        SNS_IN["SNS topic\nthreat-detected"]
        SQS_Q["SQS queue\nthreat-analysis-queue"]
        SQS_DLQ["SQS DLQ\nthreat-analysis-dlq"]
        SNS_OUT["SNS topic\nblock-ip-command"]
    end

    subgraph APP["microservice-cyberalert (NestJS)"]
        direction TB
        subgraph PRES["Presentation"]
            CTRL["ThreatsController\n(REST)"]
            HEALTH["HealthController\n(Terminus)"]
        end
        subgraph WORKER["Worker (lifecycle-driven)"]
            CONSUMER["ThreatConsumerService\nOnApplicationBootstrap/Shutdown"]
        end
        subgraph DOMAIN["Regra de negócio (pura, sem I/O)"]
            ANALYZER["SeverityAnalyzer"]
        end
        subgraph SVC["Orquestração"]
            TRIAGE["ThreatTriageService"]
        end
        subgraph INFRA["Infraestrutura"]
            REPO["Repository&lt;Threat&gt;\n(TypeORM)"]
            PUB["SnsPublisherService"]
        end
    end

    DB[("PostgreSQL\ntabela threats")]

    SCANNER -->|1. Publish JSON| SNS_IN
    SNS_IN -->|2. fan-out, raw delivery| SQS_Q
    SQS_Q -.->|falha 5x maxReceiveCount| SQS_DLQ
    SQS_Q -->|3. long-poll 20s| CONSUMER
    CONSUMER -->|4. valida + delega| TRIAGE
    TRIAGE -->|usa| ANALYZER
    TRIAGE -->|5. persiste| REPO
    REPO --> DB
    TRIAGE -->|6. se CRITICAL| PUB
    PUB --> SNS_OUT
    SNS_OUT --> BLOCKER
    CTRL -->|7. leitura síncrona| REPO
    HEALTH -.->|ping| DB

    style DOMAIN fill:#e8f5e9,stroke:#2e7d32
    style WORKER fill:#fff3e0,stroke:#e65100
    style PRES fill:#e3f2fd,stroke:#1565c0
    style INFRA fill:#fce4ec,stroke:#ad1457
```

**Por quê esta forma e não Clean Architecture estrita?** O serviço é pequeno e de responsabilidade
única (triar e persistir um evento). Introduzir portas/interfaces só para desacoplar o TypeORM
adicionaria uma camada de indireção sem ganho de testabilidade prático — o `Repository<Threat>` do
TypeORM já é mockável em testes unitários via `getRepositoryToken`. Em vez disso, o esforço de
isolamento foi investido onde ele importa: o `SeverityAnalyzer` é **mantido puro** (sem
dependências de I/O), o que o torna 100% testável com tabelas de entrada/saída, sem mocks.

---

## 2. Diagrama de classes

```mermaid
classDiagram
    class Threat {
        <<TypeORM Entity>>
        +string id
        +string threatId  «unique»
        +string source
        +string sourceIp  «indexed»
        +ThreatCategory category
        +string signature
        +Severity severity  «indexed»
        +int score
        +number cvssScore
        +number confidence
        +string[] indicators
        +Record scoreBreakdown
        +boolean blockCommandIssued
        +Date detectedAt
        +Date createdAt
        +Date updatedAt
    }

    class ThreatDetectedDto {
        <<DTO + class-validator>>
        +string threatId «@IsUUID»
        +string detectedAt «@IsISO8601»
        +string source
        +string sourceIp «@IsIP»
        +ThreatCategory category «@IsEnum»
        +string signature?
        +number cvssScore? «0..10»
        +number confidence? «0..1»
        +string[] indicators?
        +implements ThreatDetectedEvent
    }

    class SeverityAnalyzer {
        <<pure, sem I/O>>
        +analyze(event: ThreatDetectedEvent) TriageVerdict
    }

    class TriageVerdict {
        <<interface>>
        +number score
        +Severity severity
        +breakdown
    }

    class ThreatTriageService {
        -Repository~Threat~ threats
        -SeverityAnalyzer analyzer
        -SnsPublisherService publisher
        -ConfigService config
        +triage(event) TriageResult
        -emitBlockCommand(threat, verdict) void
    }

    class ThreatConsumerService {
        <<OnApplicationBootstrap, OnApplicationShutdown>>
        -SQSClient sqs
        -ThreatTriageService triage
        -boolean running
        +start() void
        +stop() void
        +pollOnce() number
        +handleMessage(message) boolean
        -pollLoop() void
        -deleteMessage(message) void
    }

    class ThreatsController {
        <<REST @Controller('threats')>>
        -Repository~Threat~ threats
        +list(query: ListThreatsQueryDto) Threat[]
        +findOne(threatId: string) Threat
    }

    class SnsPublisherService {
        -SNSClient sns
        +publish~T~(topicArn, payload, options) string
    }

    ThreatConsumerService --> ThreatDetectedDto : valida (class-validator)
    ThreatConsumerService --> ThreatTriageService : delega
    ThreatTriageService --> SeverityAnalyzer : usa
    ThreatTriageService --> TriageVerdict : produz
    ThreatTriageService --> Threat : persiste (Repository)
    ThreatTriageService --> SnsPublisherService : emite block-ip-command
    ThreatsController --> Threat : lê (Repository)
    ThreatDetectedDto ..|> TriageVerdict : entrada de analyze()
```

**Por quê `SeverityAnalyzer` é uma classe separada do `ThreatTriageService`?**
Separação de responsabilidades (SRP): `SeverityAnalyzer` decide **o quê** (pontuação), o
`ThreatTriageService` decide **o que fazer com o resultado** (idempotência, persistência,
publicação condicional). Isso permite testar o algoritmo de scoring isoladamente com dezenas de
casos de tabela sem precisar de um banco de dados ou de um SQS/SNS mockado.

**Por quê `ThreatDetectedDto implements ThreatDetectedEvent`?**
O `ThreatDetectedEvent` é o contrato de domínio (interface pura); o DTO adiciona os decorators de
`class-validator` para validação **na borda** (fronteira de I/O). Isso mantém o domínio livre de
anotações de framework, ao mesmo tempo em que garante que nenhum dado malformado atravesse a
fronteira do worker.

---

## 3. Diagrama de sequência — caminho de escrita (evento → triagem → persistência → bloqueio)

```mermaid
sequenceDiagram
    autonumber
    participant Scanner as Scanner/EDR
    participant SNS_IN as SNS: threat-detected
    participant SQS as SQS: threat-analysis-queue
    participant Consumer as ThreatConsumerService
    participant DTO as ThreatDetectedDto
    participant Triage as ThreatTriageService
    participant Analyzer as SeverityAnalyzer
    participant DB as PostgreSQL (threats)
    participant SNS_OUT as SNS: block-ip-command

    Scanner ->> SNS_IN: Publish(JSON threat-detected)
    SNS_IN ->> SQS: fan-out (RawMessageDelivery=true)

    loop pollLoop() enquanto running
        Consumer ->> SQS: ReceiveMessage (long-poll 20s, até 10 msgs)
        SQS -->> Consumer: Message[]

        loop para cada mensagem
            Consumer ->> Consumer: unwrapSnsMessage(Body)
            Consumer ->> DTO: plainToInstance + validateOrReject
            alt validação falha
                DTO -->> Consumer: ValidationError[]
                Consumer ->> Consumer: log + NÃO deleta a mensagem
                Note over Consumer,SQS: mensagem permanece na fila -\napós maxReceiveCount=5 vai para a DLQ (auditoria)
            else válido
                Consumer ->> Triage: triage(dto)
                Triage ->> DB: findOne({threatId})
                alt já existe (reentrega SQS)
                    DB -->> Triage: Threat existente
                    Triage -->> Consumer: {deduplicated: true}
                    Note over Triage,DB: idempotência: at-least-once\nnão gera duplicata
                else não existe
                    Triage ->> Analyzer: analyze(event)
                    Analyzer -->> Triage: TriageVerdict{score, severity, breakdown}
                    Triage ->> DB: save(Threat)
                    alt severity == CRITICAL
                        Triage ->> SNS_OUT: publish(BlockIpCommandEvent)
                        Triage ->> DB: save(blockCommandIssued=true)
                    end
                    Triage -->> Consumer: TriageResult
                end
                Consumer ->> SQS: DeleteMessage(ReceiptHandle)
            end
        end
    end
```

**Por quê a mensagem só é deletada no fim (linha 23), e não logo após o `ReceiveMessage`?**
Semântica **at-least-once** do SQS: se o processo cair entre o recebimento e a deleção, a
mensagem volta a ficar visível após o `VisibilityTimeout` (60s) e é reprocessada. Deletar cedo
demais arriscaria perda silenciosa de dado num crash; deletar tarde demais (só aqui) garante que
"processado" e "confirmado" sejam a mesma operação atômica do ponto de vista de efeitos observáveis
(a idempotência em `findOne(threatId)` cobre o caso de reprocessamento duplicado).

**Por quê validação falha não deleta a mensagem?**
Ao invés de silenciosamente descartar uma mensagem malformada (perda de dado sem rastro), ela é
deixada na fila. Depois de `maxReceiveCount=5` tentativas, o SQS a redireciona automaticamente
para a DLQ (`threat-analysis-dlq`), onde fica disponível para investigação manual — essencial num
pipeline de segurança, onde uma mensagem descartada pode ser justamente um ataque relevante com
payload malformado propositalmente.

---

## 4. Diagrama de sequência — caminho de leitura (REST)

```mermaid
sequenceDiagram
    autonumber
    participant Client as Dashboard/Auditoria
    participant Ctrl as ThreatsController
    participant DB as PostgreSQL (threats)

    Client ->> Ctrl: GET /threats?severity=CRITICAL&limit=50
    Ctrl ->> DB: find({where, order: detectedAt DESC, take: limit})
    DB -->> Ctrl: Threat[]
    Ctrl -->> Client: 200 OK [ThreatResponseDto...]

    Client ->> Ctrl: GET /threats/{threatId}
    Ctrl ->> Ctrl: ParseUUIDPipe (400 se inválido)
    Ctrl ->> DB: findOne({threatId})
    alt encontrado
        DB -->> Ctrl: Threat
        Ctrl -->> Client: 200 OK ThreatResponseDto
    else não encontrado
        DB -->> Ctrl: null
        Ctrl -->> Client: 200 OK (body null)
    end
```

**Por quê não-encontrado retorna `200` com corpo `null` em vez de `404`?**
Decisão deliberada de simplicidade (KISS) documentada no Swagger (`@ApiNotFoundResponse`
descreve exatamente esse comportamento): o cliente não precisa tratar `404` como um caso de erro
HTTP separado — apenas checar se o corpo é `null`. Não há alteração de estado envolvida na
consulta, então não há semântica de "recurso ausente" a proteger via status code.

---

## 5. Diagrama de atividades — algoritmo de pontuação de severidade

```mermaid
flowchart TD
    START(["analyze(event)"]) --> N1["normalizedCvss = clamp(cvssScore ?? 0 / 10, 0, 1)"]
    N1 --> N2["categoryWeight = CATEGORY_WEIGHT[category] ?? 0.5"]
    N2 --> N3["confidence = clamp(confidence ?? 0, 0, 1)"]
    N3 --> N4["indicatorBoost = min(nº_indicadores × 0.05, 0.20)"]
    N4 --> N5["combined = clamp(0.5·cvss + 0.3·categoria + 0.2·confiança + boost, 0, 1)"]
    N5 --> N6["score = round(combined × 100)"]
    N6 --> D1{"score >= 85?"}
    D1 -->|sim| S1["severity = CRITICAL"]
    D1 -->|não| D2{"score >= 60?"}
    D2 -->|sim| S2["severity = HIGH"]
    D2 -->|não| D3{"score >= 35?"}
    D3 -->|sim| S3["severity = MEDIUM"]
    D3 -->|não| S4["severity = LOW"]
    S1 --> END1(["TriageVerdict{score, severity, breakdown}"])
    S2 --> END1
    S3 --> END1
    S4 --> END1
    END1 --> D4{"severity == CRITICAL\n(em ThreatTriageService)?"}
    D4 -->|sim| B1["emitBlockCommand()\npublica em block-ip-command"]
    D4 -->|não| B2["apenas persiste"]

    style D1 fill:#ffebee
    style D2 fill:#fff8e1
    style D3 fill:#fff8e1
    style D4 fill:#ffebee
```

**Por quê um modelo de soma ponderada em vez de um modelo de ML/heurística opaca?**
Pipeline de segurança exige **auditabilidade e reprodutibilidade**: dado o mesmo evento de
entrada, o score tem que ser sempre o mesmo, e cada contribuição (`cvss`, `category`,
`confidence`, `indicatorBoost`) é persistida em `scoreBreakdown` — um analista consegue explicar
exatamente por que um evento recebeu determinada severidade, sem precisar reverter um modelo
caixa-preta. Os pesos (`cvss=0.5`, `category=0.3`, `confidence=0.2`) refletem a prioridade do
CVSS como sinal técnico primário, com a categoria da ameaça como segundo fator mais importante.

**Por quê o `indicatorBoost` é somado fora dos 3 pesos-base (que já somam 1.0) em vez de
substituir parte deles?**
Presença de IOCs (indicadores de comprometimento) é um sinal reforçador, não substitutivo — um
evento com CVSS/categoria/confiança medianos, mas múltiplos indicadores concretos, deve poder
escalar de severidade sem que isso dilua os outros fatores. O boost é limitado a 0.20 (`clamp`
final) para não permitir que indicadores, isoladamente, levem um evento fraco a CRITICAL.

---

## 6. Diagrama de estados — ciclo de vida de uma mensagem SQS

```mermaid
stateDiagram-v2
    [*] --> Received: ReceiveMessage (long-poll)
    Received --> Parsing: unwrapSnsMessage()
    Parsing --> Invalid: plainToInstance falha / validateOrReject rejeita
    Parsing --> Validated: DTO válido
    Invalid --> LeftOnQueue: NÃO deleta (log de erro)
    Validated --> Triaging: ThreatTriageService.triage()
    Triaging --> TriageFailed: exceção (ex.: DB indisponível)
    TriageFailed --> LeftOnQueue: NÃO deleta (retry)
    Triaging --> Persisted: save() bem-sucedido
    Persisted --> Deleted: DeleteMessageCommand
    Deleted --> [*]
    LeftOnQueue --> Received: reaparece após VisibilityTimeout (60s)
    LeftOnQueue --> DLQ: após maxReceiveCount=5 tentativas
    DLQ --> [*]: aguardando investigação manual
```

**Por quê existem dois caminhos de falha distintos (`Invalid` vs `TriageFailed`) que convergem no
mesmo destino (`LeftOnQueue`)?**
Ambos precisam do mesmo comportamento observável (não deletar, permitir redrive), mas têm causas
raiz diferentes — uma é erro de dado (mensagem malformada, não deve ser reprocessada com
sucesso jamais) e a outra é erro transitório de infraestrutura (banco fora do ar, deve funcionar
no próximo retry). O log distingue as duas causas para facilitar o diagnóstico operacional, mesmo
compartilhando o efeito colateral.

---

## 7. Diagrama de estados — entidade `Threat` (campo `blockCommandIssued`)

```mermaid
stateDiagram-v2
    [*] --> Created: save() inicial (blockCommandIssued=false)
    Created --> BlockCommandEmitted: severity == CRITICAL\n→ emitBlockCommand() + save()
    Created --> Stable: severity != CRITICAL
    BlockCommandEmitted --> [*]
    Stable --> [*]

    note right of BlockCommandEmitted
        Duas escritas no Postgres por design:
        1) persiste a triagem
        2) persiste blockCommandIssued=true
        somente DEPOIS que o publish() no SNS
        teve sucesso — não marca antes de emitir.
    end note
```

**Por quê duas escritas (`save()`) em vez de setar `blockCommandIssued` na primeira inserção?**
Ordem de operações deliberada: só marcar o comando como emitido **depois** que
`SnsPublisherService.publish()` retornou com sucesso evita um estado inconsistente onde o registro
diz "comando emitido" mas o SNS nunca recebeu o publish (ex.: falha de rede entre o `save()`
inicial e o `publish()`). O preço é uma segunda escrita no banco por evento crítico — aceitável
dado o volume esperado desse tipo de evento (severidade mais rara).

---

## 8. Tabela-resumo de decisões de design ("porquês")

| Decisão | Alternativa descartada | Motivo |
|---|---|---|
| Modelo de scoring por soma ponderada, com `scoreBreakdown` persistido | Modelo de ML / heurística opaca | Auditabilidade: pipeline de segurança precisa justificar cada veredito |
| `threatId` com constraint `unique` + `findOne` antes de inserir | Confiar em exactly-once do SQS | SQS padrão é at-least-once; idempotência tem que ser responsabilidade da aplicação |
| Mensagem inválida/erro de triagem NÃO é deletada da fila | Descartar e seguir em frente | Zero perda silenciosa de dado — tudo que falha vai para a DLQ para auditoria |
| `SeverityAnalyzer` sem I/O, separado do `ThreatTriageService` | Lógica de scoring dentro do service que já persiste | Testabilidade pura (SRP) — dezenas de casos de tabela sem mocks |
| `GET /threats/:id` retorna `200`+`null` em vez de `404` | 404 Not Found convencional | KISS — consulta sem efeito colateral, cliente só checa `null` |
| Marcar `blockCommandIssued=true` só após `publish()` ter sucesso | Marcar otimisticamente antes de publicar | Evita estado "disse que emitiu, mas não emitiu" em caso de falha de rede |
| Arquitetura modular NestJS (sem portas/interfaces para Postgres) | Hexagonal/Clean Architecture completa | Serviço pequeno e de responsabilidade única — indireção extra não paga seu custo aqui |

---

## 9. Referências de código

| Diagrama | Arquivos-fonte |
|---|---|
| Componentes / camadas | `src/app.module.ts`, `src/threats/threats.module.ts`, `src/messaging/messaging.module.ts` |
| Classes | `src/threats/entities/threat.entity.ts`, `src/threats/dto/threat-detected.dto.ts`, `src/threats/domain/severity-analyzer.ts`, `src/threats/threat-triage.service.ts`, `src/threats/threat-consumer.service.ts`, `src/threats/threats.controller.ts`, `src/messaging/sns-publisher.service.ts` |
| Sequência — escrita | `src/threats/threat-consumer.service.ts`, `src/threats/threat-triage.service.ts` |
| Sequência — leitura | `src/threats/threats.controller.ts` |
| Atividades — scoring | `src/threats/domain/severity-analyzer.ts`, `src/threats/domain/threat-category.enum.ts` |
| Estados — mensagem SQS | `src/threats/threat-consumer.service.ts`, `scripts/localstack-init.sh` (config da DLQ) |
| Estados — entidade Threat | `src/threats/threat-triage.service.ts` |

Ver também: [`docs/TECHNICAL_OVERVIEW.md`](./TECHNICAL_OVERVIEW.md) (métricas, cobertura, API REST completa) e [`../HOW_TO_RUN.md`](../HOW_TO_RUN.md) (como subir o serviço para testar no Postman).
