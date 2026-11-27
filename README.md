# MedFlow

Демонстрационная система записи в клинику. GitHub Pages публикует интерфейс при каждом обновлении ветки main. Аккаунты хранит Supabase Auth, профили и заявки хранит PostgreSQL.

## Настройка отдельного проекта Supabase

1. Создайте отдельный проект MedFlow в Supabase.
2. Откройте SQL Editor и один раз выполните миграцию в папке supabase/migrations. Она создаёт таблицы, правила доступа и демонстрационный каталог.
3. В Authentication → Sign In / Providers включите регистрацию по email и отключите Confirm email для тестовой версии. Оставьте анонимный вход выключенным. В URL Configuration укажите публичную ссылку GitHub Pages как Site URL.
4. В GitHub откройте Settings → Secrets and variables → Actions → Variables. Добавьте SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY из проекта MedFlow. Публичный ключ начинается с sb_publishable_. Административные ключи и пароль базы следует хранить только в Supabase.
5. В Settings → Pages выберите GitHub Actions как источник. Запустите Publish MedFlow из вкладки Actions после добавления переменных.

Для тестовой регистрации используйте новый адрес на example.com. Для такого адреса сброс пароля по почте недоступен.

## Кабинет врача

Администратор проекта создаёт тестовый аккаунт в Supabase Auth и связывает его UUID с записью врача. В SQL Editor подставьте UUID подготовленного аккаунта и выберите нужную пару clinic_id и code.

```sql
insert into public.doctor_accounts (user_id, doctor_id)
select 'UUID_АККАУНТА'::uuid, id
from public.doctors
where clinic_id = 'semey-polyclinic-1' and code = 'therapist';
```

Пациент видит свои заявки и может их отменять. Врач видит заявки, назначенные его профилю, и управляет их статусом. В публичном каталоге используются демонстрационные данные. Тестовые заявки сохраняются в проекте MedFlow.

## Документация

- [Публикация через GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Подтверждение email и анонимный вход](https://supabase.com/docs/guides/auth/general-configuration)
- [Правила доступа PostgreSQL](https://supabase.com/docs/guides/database/postgres/row-level-security)
