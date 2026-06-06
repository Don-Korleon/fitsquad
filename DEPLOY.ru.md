# FitSquad — деплой, BotFather, OpenAI

Путь проекта: `D:\Егор\apps\apps\fitnes`

---

## Содержание

1. [Локальная разработка (Windows + ngrok)](#1-локальная-разработка-windows--ngrok)
2. [BotFather — пошагово](#2-botfather--пошагово)
3. [OpenAI — подключение](#3-openai--подключение)
4. [Production на VPS (Docker)](#4-production-на-vps-docker)
5. [Nginx + SSL](#5-nginx--ssl)
6. [Cron — утренняя мотивация](#6-cron--утренняя-мотивация)
7. [Проверка и типичные ошибки](#7-проверка-и-типичные-ошибки)

---

## 1. Локальная разработка (Windows + ngrok)

Telegram Mini App **не открывается** по `http://localhost` — нужен HTTPS.

### Шаг 1 — `.env`

```powershell
cd D:\Егор\apps\apps\fitnes
Copy-Item .env.example .env
notepad .env
```

Минимум для локалки:

```env
BOT_TOKEN=123456:ABC...ваш_токен
USE_WEBHOOK=false
API_MODE=mock
PORT=3000
```

### Шаг 2 — сборка и запуск

```powershell
npm install
Set-Location webapp; npm install; Set-Location ..
npm run build
npm run dev
```

Сервер: http://localhost:3000/api/health → `{"ok":true,...}`

### Шаг 3 — ngrok

1. Установите [ngrok](https://ngrok.com/download).
2. В **новом** терминале:

```powershell
ngrok http 3000
```

3. Скопируйте HTTPS-URL, например `https://abc123.ngrok-free.app`.

### Шаг 4 — обновите `.env`

```env
PUBLIC_URL=https://abc123.ngrok-free.app
WEBAPP_URL=https://abc123.ngrok-free.app/webapp/
```

Перезапустите `npm run dev`.

### Шаг 5 — BotFather

См. [docs/BOTFATHER.md](docs/BOTFATHER.md):

- Menu Button URL = `WEBAPP_URL`
- Команды `/setcommands`

### Шаг 6 — проверка

- Бот отвечает на `/start` (long polling, `USE_WEBHOOK=false`).
- Кнопка **«🏋️ Тренировка»** открывает Mini App через ngrok.

> При смене URL ngrok (бесплатный план) обновляйте `WEBAPP_URL` и Menu Button в BotFather.

---

## 2. BotFather — пошагово

### Создать бота

1. Откройте [@BotFather](https://t.me/BotFather).
2. `/newbot` → имя **FitSquad** → username `fitsquad_bot`.
3. Токен → `BOT_TOKEN` в `.env`.

### Команды

`/setcommands` → вставьте из [docs/BOTFATHER.md](docs/BOTFATHER.md).

### Mini App (Menu Button)

`/setmenubutton` → URL:

```
https://YOUR_DOMAIN/webapp/
```

С trailing slash, как в `WEBAPP_URL`.

### Deep link для команд

После создания команды бот даёт ссылку:

```
https://t.me/fitsquad_bot?start=join_ABC123
```

---

## 3. OpenAI — подключение

Без OpenAI всё работает в **mock-режиме**: шаблонные советы AI и упрощённая верификация фото.

### Получить ключ

1. [platform.openai.com](https://platform.openai.com) → API Keys → Create.
2. Пополните баланс (pay-as-you-go).

### Настройка `.env`

```env
API_MODE=live
OPENAI_API_KEY=sk-proj-...
```

### Что включается в live-режиме

| Функция | Модель | Где используется |
|---------|--------|------------------|
| Мотивация `/motivate` | gpt-4o-mini | `src/services/aiTrainer.ts` |
| Советы во время подхода | gpt-4o-mini | Mini App → `/api/workout/:id/coach` |
| Верификация фото | gpt-4o-mini (vision) | Mini App + бот |
| Утренняя рассылка команде | gpt-4o-mini | `npm run motivation:daily` |

### Оценка расходов (V1)

При ~100 активных пользователях/день — обычно **$1–5/мес** (gpt-4o-mini).

### Проверка OpenAI

```powershell
# Запустите бота с API_MODE=live
npm run dev
```

В Telegram: `/motivate` — ответ должен быть уникальным, не из шаблона.

Загрузите фото тренировки после `/workout` — в ответе будет AI-проверка (или fallback «фото принято»).

### Если OpenAI недоступен

Код автоматически откатывается на mock/fallback — бот не падает.

---

## 4. Production на VPS (Docker)

### Требования

- Ubuntu 22.04+ / Debian 12+
- Docker + Docker Compose
- Домен с A-записью на IP сервера
- Порты 80/443 открыты

### Шаг 1 — клонирование

```bash
git clone <your-repo> /opt/fitsquad
cd /opt/fitsquad
cp .env.example .env
nano .env
```

### Шаг 2 — production `.env`

```env
BOT_TOKEN=...
BOT_USERNAME=fitsquad_bot
WEBHOOK_SECRET=длинная-случайная-строка-32+символов
PUBLIC_URL=https://fitsquad.example.com
WEBAPP_URL=https://fitsquad.example.com/webapp/
USE_WEBHOOK=true
NODE_ENV=production
API_MODE=live
OPENAI_API_KEY=sk-proj-...
```

Сгенерировать секрет:

```bash
openssl rand -hex 32
```

### Шаг 3 — деплой

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Или вручную:

```bash
npm run build
docker compose up -d --build
docker compose logs -f
```

### Шаг 4 — webhook

При `USE_WEBHOOK=true` бот **сам** вызывает `setWebhook` при старте:

```
https://fitsquad.example.com/webhook/<WEBHOOK_SECRET>
```

Проверка:

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" | jq
```

---

## 5. Nginx + SSL

### Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/fitsquad
sudo nano /etc/nginx/sites-available/fitsquad   # YOUR_DOMAIN
sudo ln -sf /etc/nginx/sites-available/fitsquad /etc/nginx/sites-enabled/
sudo certbot --nginx -d fitsquad.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Nginx проксирует на Docker-порт `3000`.

---

## 6. Cron — утренняя мотивация

Рассылка всем участникам команд (08:00 UTC = 11:00 МСК):

```bash
crontab -e
```

```
0 8 * * * cd /opt/fitsquad && docker compose exec -T fitsquad node dist/jobs/daily-motivation.js >> /var/log/fitsquad-motivation.log 2>&1
```

Без Docker:

```
0 8 * * * cd /opt/fitsquad && node dist/jobs/daily-motivation.js >> /var/log/fitsquad-motivation.log 2>&1
```

---

## 7. Проверка и типичные ошибки

### Чеклист после деплоя

| Проверка | Команда / действие | Ожидание |
|----------|-------------------|----------|
| Health | `curl https://DOMAIN/api/health` | `{"ok":true,"name":"FitSquad"}` |
| Mini App | Menu Button в боте | Открывается webapp |
| Webhook | `getWebhookInfo` | URL без ошибок |
| Команда | `/team` → создать | Код приглашения |
| Тренировка | Mini App → подходы → завершить | +10 FS |
| Фото | загрузить в Mini App | +15 FS |
| AI | `/motivate` при `API_MODE=live` | Уникальный текст |

### «Mini App не открывается»

- `WEBAPP_URL` должен быть **https://**
- Menu Button в BotFather = тот же URL
- `npm run build` — webapp собран в `webapp/dist/`

### «401 Invalid init data» в Mini App

- Mini App открыт **через Telegram**, не в обычном браузере
- `BOT_TOKEN` в `.env` совпадает с ботом, из которого открыли App

### Бот не отвечает на VPS

- `USE_WEBHOOK=true` и `PUBLIC_URL` доступен снаружи
- Nginx пропускает `/webhook/`
- `docker compose logs -f` — нет ошибок BOT_TOKEN

### База данных

SQLite в Docker volume `fitsquad-data`. Бэкап:

```bash
docker compose exec fitsquad cat /app/data/fitsquad.db > backup.db
```

---

## Быстрая шпаргалка `.env`

| Режим | USE_WEBHOOK | API_MODE | WEBAPP_URL |
|-------|-------------|----------|------------|
| Локально (только бот) | false | mock | не нужен |
| Локально + Mini App | false | mock | ngrok https |
| Production | true | live | https://domain/webapp/ |

Подробные тексты BotFather: [docs/BOTFATHER.md](docs/BOTFATHER.md)
