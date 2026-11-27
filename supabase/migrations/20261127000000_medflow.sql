begin;

create table public.clinics (
  id text primary key,
  name text not null
);

create table public.doctors (
  id bigint generated always as identity primary key,
  clinic_id text not null references public.clinics,
  code text not null,
  name text not null,
  unique (id, clinic_id),
  unique (clinic_id, code)
);

create table public.services (
  id bigint generated always as identity primary key,
  clinic_id text not null references public.clinics,
  name text not null,
  price text not null,
  unique (id, clinic_id),
  unique (clinic_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  clinic_id text not null references public.clinics,
  name text not null check (char_length(trim(name)) between 1 and 100),
  unique (id, clinic_id)
);

create table public.doctor_accounts (
  user_id uuid primary key references auth.users on delete cascade,
  doctor_id bigint not null unique references public.doctors
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null default auth.uid(),
  clinic_id text not null,
  doctor_id bigint not null,
  service_id bigint,
  patient_name text not null,
  visit_date date not null,
  visit_time time(0) not null,
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'Новая'
    check (status in ('Новая', 'Подтверждена', 'Завершена', 'Отменена')),
  foreign key (patient_id, clinic_id) references public.profiles(id, clinic_id) on delete cascade,
  foreign key (doctor_id, clinic_id) references public.doctors(id, clinic_id),
  foreign key (service_id, clinic_id) references public.services(id, clinic_id)
);
create index appointments_patient on public.appointments (patient_id);
create index appointments_doctor on public.appointments (doctor_id);
create unique index appointments_active_slot
  on public.appointments (doctor_id, visit_date, visit_time)
  where status <> 'Отменена';

-- An Auth account becomes a patient only with a valid clinic and display name.
-- Staffing is assigned separately by the project administrator.
create function public.medflow_new_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, clinic_id, name)
  select new.id, c.id, trim(new.raw_user_meta_data ->> 'name')
  from public.clinics c
  where c.id = new.raw_user_meta_data ->> 'clinic_id'
    and char_length(trim(new.raw_user_meta_data ->> 'name')) between 1 and 100;
  return new;
end;
$$;
revoke all on function public.medflow_new_profile() from public, anon, authenticated;
create trigger medflow_profile_after_signup after insert on auth.users
for each row execute function public.medflow_new_profile();

-- Browser clients supply the desired slot. Ownership and initial status come from the database.
create function public.medflow_prepare_appointment() returns trigger
language plpgsql set search_path = '' as $$
begin
  select p.clinic_id, p.name into new.clinic_id, new.patient_name
  from public.profiles p where p.id = new.patient_id;
  if new.clinic_id is null then
    raise exception 'Сначала выберите клинику при регистрации' using errcode = '23514';
  end if;
  if new.visit_date + new.visit_time <= timezone('Asia/Almaty', now()) then
    raise exception 'Выберите дату и время в будущем' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.medflow_prepare_appointment() from public, anon, authenticated;
create trigger medflow_prepare_appointment before insert on public.appointments
for each row execute function public.medflow_prepare_appointment();

create function public.medflow_check_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if old.status in ('Новая', 'Подтверждена') and new.status = 'Отменена' then
    return new;
  end if;
  if exists (select 1 from public.doctor_accounts d
             where d.user_id = (select auth.uid()) and d.doctor_id = old.doctor_id)
     and ((old.status = 'Новая' and new.status = 'Подтверждена')
          or (old.status = 'Подтверждена' and new.status = 'Завершена')) then
    return new;
  end if;
  raise exception 'Этот переход между статусами недоступен' using errcode = '23514';
end;
$$;
revoke all on function public.medflow_check_status() from public, anon, authenticated;
create trigger medflow_check_status before update of status on public.appointments
for each row execute function public.medflow_check_status();

alter table public.clinics enable row level security;
alter table public.doctors enable row level security;
alter table public.services enable row level security;
alter table public.profiles enable row level security;
alter table public.doctor_accounts enable row level security;
alter table public.appointments enable row level security;

revoke all on public.clinics, public.doctors, public.services, public.profiles,
  public.doctor_accounts, public.appointments from public, anon, authenticated;
grant select on public.clinics to anon, authenticated;
grant select on public.doctors, public.services, public.profiles,
  public.doctor_accounts, public.appointments to authenticated;
grant update (name) on public.profiles to authenticated;
grant insert (doctor_id, service_id, visit_date, visit_time, note) on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;

-- Shared directories contain only demonstration information.
create policy clinics_catalog on public.clinics for select to anon, authenticated using (true);
create policy doctors_catalog on public.doctors for select to authenticated using (true);
create policy services_catalog on public.services for select to authenticated using (true);

create policy own_profile_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy own_profile_edit on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy own_doctor_account on public.doctor_accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy appointment_read on public.appointments for select to authenticated
  using (patient_id = (select auth.uid()) or doctor_id in (select doctor_id from public.doctor_accounts));
create policy appointment_create on public.appointments for insert to authenticated
  with check (
    patient_id = (select auth.uid()) and status = 'Новая'
    and not exists (select 1 from public.doctor_accounts)
    and clinic_id in (select clinic_id from public.profiles)
  );
create policy appointment_status on public.appointments for update to authenticated
  using (patient_id = (select auth.uid()) or doctor_id in (select doctor_id from public.doctor_accounts))
  with check (patient_id = (select auth.uid()) or doctor_id in (select doctor_id from public.doctor_accounts));
insert into public.clinics (id, name) values
    ('semey-polyclinic-1', 'Поликлиника № 1 города Семей'),
    ('semey-polyclinic-2', 'Поликлиника № 2 города Семей'),
    ('semey-polyclinic-4', 'Поликлиника № 4 города Семей'),
    ('semey-polyclinic-7', 'Поликлиника № 7 города Семей'),
    ('semey-polyclinic-9', 'Поликлиника № 9 города Семей'),
    ('semey-city-hospital-1', 'Городская больница № 1 города Семей'),
    ('semey-emergency-hospital', 'Больница скорой медицинской помощи города Семей');

insert into public.doctors (clinic_id, code, name)
select clinics.id, catalog.*
from public.clinics
cross join (values
    ('therapist', 'Айгерім Нұрланова — терапевт (демо)'),
    ('cardiologist', 'Нұрсұлтан Әлиев — кардиолог (демо)'),
    ('pediatrician', 'Динара Омарова — педиатр (демо)'),
    ('neurologist', 'Арман Бекенов — невролог (демо)'),
    ('gynecologist', 'Жанар Қасымова — гинеколог (демо)'),
    ('surgeon', 'Мәди Төлебаев — хирург (демо)'),
    ('dermatologist', 'Айдана Серікова — дерматолог (демо)'),
    ('ent', 'Ерлан Жұмабек — ЛОР (демо)')
) as catalog(code, name);

insert into public.services (clinic_id, name, price)
select clinics.id, catalog.*
from public.clinics
cross join (values
    ('Первичный приём терапевта', '5 000 ₸ · демо'),
    ('Консультация кардиолога', '7 000 ₸ · демо'),
    ('Приём педиатра', '5 000 ₸ · демо'),
    ('Консультация невролога', '6 500 ₸ · демо'),
    ('Приём гинеколога', '7 000 ₸ · демо'),
    ('Консультация хирурга', '7 000 ₸ · демо'),
    ('Приём дерматолога', '6 000 ₸ · демо'),
    ('Консультация ЛОР-врача', '5 500 ₸ · демо'),
    ('ЭКГ', '3 000 ₸ · демо'),
    ('УЗИ брюшной полости', '8 000 ₸ · демо'),
    ('Общий анализ крови', '2 500 ₸ · демо'),
    ('Офтальмологический осмотр', '5 000 ₸ · демо')
) as catalog(name, price);

commit;
