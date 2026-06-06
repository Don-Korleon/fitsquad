# Деплой FitSquad на Vercel (пошагово для новичков)

Vercel — бесплатный хостинг, который даёт **HTTPS-ссылку** вида:

`https://fitsquad-xxxx.vercel.app`

Telegram требует HTTPS для Mini App и webhook бота — Vercel подходит идеально.

---

## Что важно знать заранее

| Тема | На Vercel |
|------|-----------|
| Публичная ссылка | `https://ваш-проект.vercel.app` |
| Mini App | `https://ваш-проект.vercel.app/webapp/` |
| Бот | Работает через **webhook** (не через `npm run dev` на ПК) |
| База SQLite | Временная (`/tmp`) — данные **могут сбрасываться** при перезапуске |
| Фото | Тоже временные — для постоянного хранения позже нужен VPS |

---

## Шаг 1. Регистрация на GitHub

**GitHub** — сайт, где хранится код. Vercel умеет автоматически брать проект оттуда.

1. Откройте https://github.com
2. Нажмите **Sign up** и создайте аккаунт (если ещё нет)

---

## Шаг 2. Установите Git (если ещё нет)

1. Скачайте: https://git-scm.com/download/win
2. Установите с настройками по умолчанию (везде **Next**)
3. Перезапустите PowerShell

Проверка:

```powershell
git --version
```

Должна появиться версия, например `git version 2.x`.

---

## Шаг 3. Загрузите проект на GitHub

### 3.1. Откройте PowerShell в папке проекта

```powershell
cd D:\Егор\apps\apps\fitnes
```

### 3.2. Создайте репозиторий на GitHub

1. На GitHub нажмите **+** → **New repository**
2. Имя, например: `fitsquad`
3. **Private** (приватный) или Public — на ваш выбор
4. **Не** ставьте галочки README / .gitignore — проект уже есть локально
5. **Create repository**

### 3.3. Отправьте код на GitHub

Подставьте **свой логин** вместо `ВАШ_ЛОГИН`:

```powershell
git init
git add .
git commit -m "FitSquad MVP"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/fitsquad.git
git push -u origin main
```

GitHub попросит войти (браузер или токен).

> Файл `.env` **не попадёт** в GitHub — он в `.gitignore`. Секреты останутся только у вас.

---

## Шаг 4. Регистрация на Vercel

1. Откройте https://vercel.com
2. **Sign Up** → **Continue with GitHub**
3. Разрешите Vercel доступ к репозиториям

---

## Шаг 5. Импорт проекта в Vercel

1. В Vercel нажмите **Add New…** → **Project**
2. Найдите репозиторий **fitsquad** → **Import**
3. Настройки сборки подтянутся из `vercel.json` автоматически:
   - **Build Command:** `npm run build:vercel`
   - **Install Command:** `npm install && npm install --prefix webapp`
4. **Пока не нажимайте Deploy** — сначала добавьте переменные (шаг 6)

---

## Шаг 6. Переменные окружения

В разделе **Environment Variables** добавьте (для **Production**, **Preview**, **Development**):

| Имя | Значение | Зачем |
|-----|----------|--------|
| `BOT_TOKEN` | токен от @BotFather | Telegram-бот |
| `WEBHOOK_SECRET` | случайная строка, напр. `fitsquad-secret-abc123` | Защита webhook |
| `NODE_ENV` | `production` | Режим продакшена |
| `API_MODE` | `mock` или `live` | AI: шаблоны или OpenAI |
| `OPENAI_API_KEY` | `sk-proj-...` | Только если `API_MODE=live` |

Нажмите **Deploy** и подождите 2–5 минут, пока появится зелёная галочка **Ready**.

Скопируйте URL проекта, например: `https://fitsquad-abc123.vercel.app`

---

## Шаг 7. Добавьте URL после первого деплоя

В Vercel: **Settings** → **Environment Variables** → добавьте:

| Имя | Пример |
|-----|--------|
| `PUBLIC_URL` | `https://fitsquad-abc123.vercel.app` |
| `WEBAPP_URL` | `https://fitsquad-abc123.vercel.app/webapp/` |
| `USE_WEBHOOK` | `true` |
| `SKIP_SET_WEBHOOK` | `true` |

Нажмите **Deployments** → три точки у последнего деплоя → **Redeploy** (чтобы подхватились новые переменные).

---

## Шаг 8. Проверка в браузере

Откройте в Chrome:

| Ссылка | Что должно быть |
|--------|-----------------|
| `https://ВАШ-ПРОЕКТ.vercel.app/` | Редirect на Mini App |
| `https://ВАШ-ПРОЕКТ.vercel.app/webapp/` | Интерфейс FitSquad |
| `https://ВАШ-ПРОЕКТ.vercel.app/api/health` | `{"ok":true,"name":"FitSquad",...}` |

---

## Шаг 9. Подключите webhook Telegram

Бот на Vercel работает только через webhook. В PowerShell:

```powershell
$token = "ВАШ_BOT_TOKEN"
$domain = "https://fitsquad-abc123.vercel.app"
$secret = "fitsquad-secret-abc123"

$body = @{
  url = "$domain/webhook/$secret"
  secret_token = $secret
  drop_pending_updates = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" -Method Post -ContentType "application/json" -Body $body
```

Ответ: `"ok": true`.

Проверка:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo"
```

В поле `url` должен быть ваш адрес `/webhook/...`.

> **Важно:** остановите локальный `npm run dev`, если он запущен — иначе бот будет получать сообщения и локально, и на Vercel одновременно.

---

## Шаг 10. Настройка BotFather

1. Откройте [@BotFather](https://t.me/BotFather)
2. **/mybots** → ваш бот → **Bot Settings** → **Menu Button**
3. **Configure menu button** → **Web App**
4. URL:

```
https://ВАШ-ПРОЕКТ.vercel.app/webapp/
```

5. Текст кнопки: `🏋️ Тренировка`

Команды и описание — в [docs/BOTFATHER.md](docs/BOTFATHER.md).

---

## Шаг 11. Проверка в Telegram

1. Откройте бота → `/start`
2. `/team` → создайте команду
3. Нажмите **🏋️ Тренировка** — откроется Mini App с Vercel
4. `/motivate` — сообщение от AI-тренера

Если бот молчит: **Vercel → Project → Logs** и повторите шаг 9.

---

## Обновление после изменений кода

```powershell
cd D:\Егор\apps\apps\fitnes
git add .
git commit -m "update"
git push
```

Vercel **сам** пересоберёт проект за 1–3 минуты.

---

## Частые проблемы

| Проблема | Решение |
|---------|---------|
| Build failed | Vercel → Deployments → failed → читайте красный лог |
| Бот не отвечает | Повторите `setWebhook`, проверьте `BOT_TOKEN` и `WEBHOOK_SECRET` |
| Mini App пустой | Откройте `/webapp/` в браузере; проверьте, что деплой успешен |
| «Откройте через Telegram» | Нормально в браузере; полный функционал — только из бота |
| Данные пропали | SQLite на Vercel временная — для постоянной БД нужен VPS |
| Два бота отвечают | Остановите локальный `npm run dev` |

---

## Локально vs Vercel

| | Локально | Vercel |
|--|----------|--------|
| URL | `http://localhost:3000` | `https://....vercel.app` |
| Бот | Long polling | Webhook |
| Mini App в Telegram | Нужен ngrok | Работает сразу |
| Постоянная БД | Да (`data/`) | Нет (`/tmp`) |

Можно разрабатывать локально и держать на Vercel публичную версию для пользователей.

---

## Ваша публичная ссылка

После деплоя главные адреса:

- **Сайт / Mini App:** `https://ВАШ-ПРОЕКТ.vercel.app/webapp/`
- **API:** `https://ВАШ-ПРОЕКТ.vercel.app/api/health`

Именно `WEBAPP_URL` укажите в BotFather.
