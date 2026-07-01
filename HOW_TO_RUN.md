# Como rodar os microservices (para testes via Postman)

Guia rápido para subir os dois microservices localmente e testá-los pelo Postman.

- **Threat Triage & Alerts Engine** — `microservice-cyberalert/` — REST, porta **3001**
- **Profile Service** — `microservice-nest/profile-service/` — GraphQL, porta **3000**

Cada serviço é independente (repositórios/infra separados) — pode subir só um ou os dois.

---

## 0. Pré-requisitos

- Docker Desktop rodando (infra de cada serviço sobe via `docker compose`).
- Node.js + npm instalados.
- Collection do Postman: importe `microservice-nest/docs/postman/collection.json` e o
  environment `microservice-nest/docs/postman/environment.json` (selecione
  **"Microservices TS — Local"** depois de importar). Essa collection cobre os dois serviços.

---

## 1. Threat Triage & Alerts Engine (`microservice-cyberalert`)

REST API somente leitura sobre inteligência de ameaças consolidada. O caminho de escrita é
orientado a eventos (SNS → SQS → worker), não há endpoint de criação via HTTP.

```bash
cd microservice-cyberalert

# 1. Variáveis de ambiente (só na primeira vez)
cp .env.example .env

# 2. Infra: Postgres (5432) + LocalStack SNS/SQS (4566)
docker compose up -d

# 3. Dependências
npm install

# 4. Build + start
npm run build
npm run start:prod
# (alternativa em modo watch: npm run start:dev)
```

Serviço disponível em **http://localhost:3001**:

| Recurso | URL |
|---|---|
| Health check | `GET http://localhost:3001/health` |
| Listar threats | `GET http://localhost:3001/threats?limit=50` |
| Buscar threat por ID | `GET http://localhost:3001/threats/{threatId}` |
| Swagger UI | `http://localhost:3001/api/docs` |
| Swagger JSON | `http://localhost:3001/api/docs-json` |

Não há dados sem eventos publicados no tópico SNS (`threat-detected`) via LocalStack — para
popular a base, publique um evento de exemplo na fila/tópico configurados em `.env`
(`THREAT_ANALYSIS_QUEUE_URL`, veja `scripts/` do projeto se existir um helper de seed).

---

## 2. Profile Service (`microservice-nest/profile-service`)

API GraphQL com autenticação JWT (ver seção 3 abaixo). Escrita via outbox transacional →
SNS → SQS → indexação no OpenSearch (leitura de busca fica eventualmente consistente).

```bash
cd microservice-nest/profile-service

# 1. Variáveis de ambiente (só na primeira vez)
cp .env.example .env
# Gere um JWT_SECRET forte e cole em .env (obrigatório — o app falha ao subir sem ele):
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# 2. Infra: Postgres (5433) + OpenSearch (9200) + LocalStack SNS/SQS (4567)
docker compose up -d

# 3. Dependências
npm install

# 4. Prisma: gerar client e sincronizar schema
npx prisma generate
npx prisma db push

# 5. Build + start
npm run build
node dist/main.js
# (alternativa em modo watch: npm run start:dev)
```

Serviço disponível em **http://localhost:3000**:

| Recurso | URL |
|---|---|
| Health check | `GET http://localhost:3000/health` |
| GraphQL endpoint | `POST http://localhost:3000/graphql` |
| Swagger UI | `http://localhost:3000/api/docs` |
| Swagger JSON | `http://localhost:3000/api/docs-json` |

Não existe GraphQL Playground/introspection habilitado fora de ambiente de desenvolvimento
(hardening de segurança) — use a collection do Postman ou Swagger para explorar o schema.

---

## 3. Autenticação JWT no Profile Service

`updateProfile` e `deleteProfile` exigem um token JWT do **próprio** perfil (proteção contra
IDOR). Fluxo esperado ao testar no Postman:

1. **Create Profile** (`createProfile`) — não requer token. Retorna `{ profile, accessToken }`.
   A request da collection já salva o token em `{{access_token}}` e o id em `{{profile_id}}`
   automaticamente (script de teste).
2. **Update Profile** / **Delete Profile** — enviam `Authorization: Bearer {{access_token}}`
   automaticamente (já configurado na collection). Só funcionam se o `sub` do token bater com
   o `id` do perfil alvo.
3. **Get Profile** / **Search Profiles** — públicos, não exigem token.

Códigos de erro GraphQL (`extensions.code`) para testar cenários negativos (já há exemplos
prontos na pasta "GraphQL — Error scenarios" da collection):

| `extensions.code` | HTTP | Quando ocorre |
|---|---|---|
| `BAD_USER_INPUT` | 400 | Validação falhou |
| `CONFLICT` | 409 | Username/email já em uso |
| `NOT_FOUND` | 404 | Perfil não encontrado |
| `PRECONDITION_FAILED` | 412 | Conflito de versão (optimistic locking) |
| `UNAUTHENTICATED` | 401 | Sem token / token inválido em `updateProfile`/`deleteProfile` |
| `FORBIDDEN` | 403 | Token válido, mas de outro perfil (não é o dono) |

Token: HS256, expira em 1h (`JWT_EXPIRES_IN` no `.env`), `sub` = id do perfil.

---

## 4. Resumo de portas

| Serviço | App | Postgres | Outro |
|---|---|---|---|
| Threat Triage | 3001 | 5432 | LocalStack SNS/SQS: 4566 |
| Profile Service | 3000 | 5433 | OpenSearch: 9200 · LocalStack SNS/SQS: 4567 |

Como as portas de infra não colidem, dá para rodar os dois `docker compose up -d` e os dois
apps ao mesmo tempo sem conflito.

---

## 5. Parar tudo

```bash
# em cada pasta de serviço
docker compose down
```

Use `docker compose down -v` se quiser também apagar os volumes (dados do Postgres/OpenSearch).
