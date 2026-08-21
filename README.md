# campaign-graph

Корреляционный граф кампаний для экосистемы UntilSec: принимает события от
трёх независимых детекторов, сводит их в один граф сущностей и ищет, какие
из них на самом деле части одной кампании.

Next.js 16 (App Router) + PostgreSQL через Drizzle ORM.

## Зачем

Каждый детектор видит свой кусок:

| Источник | Что присылает |
|---|---|
| [Secret-Exposure-Monitor](https://github.com/wykserdex/Secret-Exposure-Monitor) | утёкшие секреты в публичных репозиториях |
| [Leak-Intelligence](https://github.com/wykserdex/Leak-Intelligence) | наблюдения и оценки утечек данных |
| [UntilPhish-Go](https://github.com/wykserdex/UntilPhish-Go) | вердикты по фишинговым URL |

По отдельности это разрозненные инциденты. Граф связывает их через общую
инфраструктуру, общие секреты и общих акторов — и поднимает гипотезу, что за
ними стоит одна кампания.

Ключевые решения движка корреляции:

- **гипотеза, а не факт** — связь сначала попадает в `correlation_hypotheses`
  и требует подтверждения (`/api/v1/hypotheses/[id]/approve`), автоматика сама
  ничего не «склеивает» окончательно;
- **транзитивность кампаний** — если A связали с B, а потом отдельно B с C, то
  A, B и C оказываются в ОДНОЙ кампании, а не в двух (регрессионный тест
  `correlation-transitivity.test.ts`);
- **PII не хранится в открытом виде** — субъекты утечек попадают в граф как
  `SubjectIndex` через слепой индекс (`src/lib/domain/pii.ts`).

Это v2. Первая версия жила как набор Python-скриптов —
[threat-intel-graph](https://github.com/wykserdex/threat-intel-graph).

## Запуск

Нужны Node 22+ и PostgreSQL 15+.

```bash
npm ci

# схема БД (креды должны совпадать с vitest.config.ts / drizzle.config.json)
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push

npm run dev          # http://localhost:3000
```

Проверки, которые гоняет CI:

```bash
npm run typecheck
npm run lint
npm test
```

## Приём событий

Создай тенанта — в ответ один раз (и больше никогда) отдаются сырые ключи,
по одному на источник:

```bash
curl -X POST http://localhost:3000/api/v1/tenants \
     -H "Content-Type: application/json" \
     -d '{"name":"Acme"}'
```

Дальше события шлются с этим ключом:

```bash
curl -X POST http://localhost:3000/api/v1/ingest/until-phish \
     -H "Authorization: Bearer sk_until-phish_..." \
     -H "Content-Type: application/json" \
     -d @event.json
```

Ключ хранится только как SHA-256 (`ingestion_api_keys.key_hash`) и привязан
ровно к одному источнику: ключом от `leak-intelligence` нельзя записать в граф
события `until-phish`. Без валидного ключа роут отвечает 401, при неверном
источнике — 403.

## API

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/v1/ingest/[source]` | приём событий (требует ключ) |
| `GET` | `/api/v1/nodes` | узлы графа |
| `GET` | `/api/v1/campaigns` | список кампаний |
| `GET` | `/api/v1/campaigns/[id]` | кампания целиком |
| `GET` | `/api/v1/campaigns/[id]/timeline` | хронология |
| `GET` | `/api/v1/campaigns/[id]/sources` | вклад каждого источника |
| `GET` | `/api/v1/campaigns/[id]/explain` | почему эти узлы вместе |
| `GET`/`POST` | `/api/v1/hypotheses` | гипотезы корреляции |
| `POST` | `/api/v1/hypotheses/[id]/approve` \| `/reject` | вердикт аналитика |
| `POST` | `/api/v1/correlation/run` | прогнать движок вручную |
| `GET`/`POST` | `/api/v1/tenants` | тенанты и выпуск ключей |
| `GET` | `/api/health` | health check |

## Структура

```
src/
├── app/              # маршруты Next.js (App Router) — единственное место с роутами
│   └── api/v1/       # публичный API
├── db/               # схема Drizzle и пул подключений
└── lib/
    ├── domain/       # канонические типы, enum'ы, PII-хеширование
    ├── ingest/       # адаптеры источников, идемпотентность, аутентификация
    ├── correlation/  # сигналы, скоринг, гипотезы
    ├── graph/        # запись и чтение графа
    └── __tests__/    # vitest
```

## Лицензия

MIT
