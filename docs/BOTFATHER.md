# Тексты для @BotFather — FitSquad

Скопируйте нужный блок в [@BotFather](https://t.me/BotFather).

---

## 1. Создание бота

```
/newbot
```

| Поле | Значение |
|------|----------|
| Display name | `FitSquad` |
| Username | `fitsquad_bot` (или свободный `*_bot`) |

Сохраните **токен** → `BOT_TOKEN` в `.env`.

---

## 2. Команды — `/setcommands`

Выберите бота, вставьте:

```
start - Начать
team - Команда (до 5 человек)
workout - Тренировка дня
motivate - Мотивация от AI-тренера
stats - FS-tokens и достижения
help - Справка
```

---

## 3. Описание — `/setdescription`

```
🏋️ FitSquad — социальная фитнес-платформа в Telegram

Тренируйся с командой до 5 человек, получай FS-tokens за достижения и советы от AI-тренера.

• Создай команду или вступи по коду
• Командная тренировка каждый день
• Mini App: таймер, подходы, верификация фото
• Streak, ачивки, лидерборд

Команды: /team /workout /motivate /stats
```

---

## 4. Краткое «О боте» — `/setabouttext`

```
Командные тренировки + AI-тренер + FS-tokens. Команда до 5 человек, Mini App для занятий.
```

---

## 5. Menu Button — `/setmenubutton`

| Поле | Значение |
|------|----------|
| URL | `https://YOUR_DOMAIN/webapp/` |

**Важно:** только `https://`, не `http://localhost`.

Пример: `https://fitsquad.example.com/webapp/`

---

## 6. Web App domain (если BotFather спрашивает)

В некоторых версиях BotFather:

```
/mybots → выберите бота → Bot Settings → Configure Mini App
```

Domain: `YOUR_DOMAIN` (без `/webapp/`).

---

## 7. Аватар (опционально)

`/setuserpic` — лого с гантелью или эмодзи 🏋️.

---

## Проверка после настройки

1. Откройте бота → `/start` — приветствие и клавиатура.
2. Кнопка **«🏋️ Тренировка»** открывает Mini App (нужен HTTPS).
3. `/team` → создайте команду → скопируйте код приглашения.
