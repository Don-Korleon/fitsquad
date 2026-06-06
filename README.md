# FitSquad — социальная фитнес-платформа

Telegram-бот + Mini App для командных тренировок с AI-тренером, верификацией через фото и FS-тokens за достижения.

**Стек:** Node.js 22+, TypeScript, Express, grammY, SQLite, Vite.

## V1 — что входит

- **5 базовых упражнений:** отжимания, приседания, планка, прыжки, бёрпи
- **Команды до 5 человек** с кодом приглашения
- **Командные тренировки** — общее упражнение дня, прогресс команды
- **AI-тренер** — мотивация и советы (mock или OpenAI)
- **Верификация фото** — загрузка в Mini App или отправка боту
- **FS-tokens** — за тренировки, фото, streak и командный бонус
- **Gamification** — 4 достижения, лидерборд команды

## Быстрый старт

```powershell
cd D:\Егор\apps\apps\fitnes
Copy-Item .env.example .env
# Заполните BOT_TOKEN в .env

npm install
cd webapp && npm install && cd ..
npm run dev
```

Сервер: `http://localhost:3000`  
Mini App (dev): соберите `npm run build:webapp` или используйте ngrok для HTTPS.

## BotFather

1. `/newbot` → имя **FitSquad**, username `fitsquad_bot`
2. `/setcommands`:
   ```
   start - Начать
   team - Команда
   workout - Тренировка дня
   motivate - Мотивация AI
   stats - Статистика и FS
   help - Справка
   ```
3. Menu Button → `WEBAPP_URL` (HTTPS)

## Переменные окружения

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен Telegram-бота |
| `WEBAPP_URL` | HTTPS URL Mini App |
| `API_MODE` | `mock` или `live` (OpenAI) |
| `OPENAI_API_KEY` | Для live AI и верификации фото |
| `MAX_TEAM_SIZE` | Макс. размер команды (5) |
| `FS_*` | Награды за действия |

## FS-tokens

| Действие | FS |
|---|---|
| Завершить тренировку | +10 |
| Верификация фото | +15 |
| Вся команда выполнила | +25 |
| Streak (со 2-го дня) | +5/день |

## API

- `GET /api/me` — профиль
- `GET /api/team` — команда
- `GET /api/workout/today` — тренировка дня
- `POST /api/workout/:id/complete` — завершить
- `POST /api/workout/:id/verify` — загрузить фото
- `GET /api/leaderboard` — лидерборд

## Ежедневная мотивация (cron)

```bash
npm run motivation:daily
```

Пример crontab (08:00 UTC):

```
0 8 * * * cd /path/to/fitnes && node dist/jobs/daily-motivation.js
```

## Production и настройка

- **Vercel (рекомендуется для новичков):** [DEPLOY-VERCEL.ru.md](DEPLOY-VERCEL.ru.md) — бесплатный HTTPS за 15 минут
- **VPS / Docker:** [DEPLOY.ru.md](DEPLOY.ru.md)
- **BotFather:** [docs/BOTFATHER.md](docs/BOTFATHER.md)
