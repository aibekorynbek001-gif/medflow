const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const toggle = (selector, visible) => $(selector).classList.toggle('hidden', !visible);
const statusLabels = {
  'Новая': 'new',
  'Подтверждена': 'confirmed',
  'Завершена': 'done',
  'Отменена': 'cancel',
};

let supabase;
let account;
let appointments = [];
let page = 'appointments';
let renderVersion = 0;
let toastTimer;

function feedback(text, selector = '#toast') {
  const element = $(selector);
  element.textContent = text;
  if (selector !== '#toast') {
    toggle(selector, Boolean(text));
    return;
  }
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3800);
}

function failure(error) {
  if (error.code === '23505') return 'Это время у врача уже занято.';
  if (error.code === '23503') return 'Врач или услуга недоступны для вашей клиники.';
  if (error.code === 'invalid_credentials') return 'Проверьте email и пароль.';
  if (error.code === 'user_already_exists') return 'Этот email уже зарегистрирован. Войдите или выберите другой тестовый адрес.';
  return error.message || 'Не удалось выполнить запрос.';
}

async function get(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function setTab(tab) {
  for (const button of $$('.tab')) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  toggle('#loginForm', tab === 'login');
  toggle('#patientForm', tab === 'patient');
  feedback('', '#authMessage');
}

function setOptions(select, label, rows, format = row => row.name) {
  select.replaceChildren(new Option(label, ''), ...rows.map(row => new Option(format(row), row.id)));
}

async function loadAccount(user) {
  const [profile, access] = await Promise.all([
    get(supabase.from('profiles').select('id,name,clinic_id,clinic:clinics(name)').eq('id', user.id).maybeSingle()),
    get(supabase.from('doctor_accounts').select('doctor:doctors(id,name,clinic_id,clinic:clinics(name))').eq('user_id', user.id).maybeSingle()),
  ]);
  const doctor = access?.doctor;
  if (doctor) return { ...doctor, isDoctor: true };
  if (profile) return { ...profile, isDoctor: false };
  throw new Error('Для этого аккаунта ещё не настроен кабинет MedFlow.');
}

async function loadBookingOptions() {
  const [doctors, services] = await Promise.all([
    get(supabase.from('doctors').select('id,name').eq('clinic_id', account.clinic_id).order('name')),
    get(supabase.from('services').select('id,name,price').eq('clinic_id', account.clinic_id).order('name')),
  ]);
  setOptions($('#doctorSelect'), 'Выберите специалиста', doctors);
  setOptions($('#serviceSelect'), 'Без выбора услуги', services, row => row.name + ' · ' + row.price);
}

function showAuth() {
  renderVersion++;
  account = null;
  appointments = [];
  $('#appointmentList').replaceChildren();
  $('#serviceList').replaceChildren();
  $('#clinicLabel').textContent = '';
  toggle('#logoutBtn', false);
  toggle('#appView', false);
  toggle('#authView', true);
}

async function showAccount(user) {
  account = await loadAccount(user);
  if (!account.isDoctor) {
    await loadBookingOptions();
    $('#visitDate').min = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  $('#clinicLabel').textContent = account.clinic.name;
  $('#userChip').textContent = account.name + ' · ' + (account.isDoctor ? 'Врач' : 'Пациент');
  $('#appointmentNavLabel').textContent = account.isDoctor ? 'Кабинет врача' : 'Мои записи';
  $('#appointmentFilter').value = 'all';
  toggle('#authView', false);
  toggle('#appView', true);
  toggle('#logoutBtn', true);
  await openPage('appointments');
}

function writeText(parent, tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function setEmpty(title = '', subtitle = '') {
  $('#emptyState h3').textContent = title;
  $('#emptyState p').textContent = subtitle;
  toggle('#emptyState', Boolean(title));
}

async function openPage(name) {
  if (!account) return;
  const version = ++renderVersion;
  page = name;
  const isVisitPage = name === 'appointments';
  for (const button of $$('.navitem')) button.classList.toggle('active', button.dataset.page === name);
  toggle('#appointmentList', isVisitPage);
  toggle('#serviceList', !isVisitPage);
  toggle('#patientBook', isVisitPage && !account.isDoctor);
  toggle('#doctorPanel', isVisitPage && account.isDoctor);
  $('#pageTitle').textContent = isVisitPage ? (account.isDoctor ? 'Кабинет врача' : 'Мои записи') : 'Услуги';
  $('#pageSubtitle').textContent = isVisitPage
    ? (account.isDoctor ? 'Управляйте назначенными вам заявками.' : 'Здесь отображаются ваши заявки на приём.')
    : 'Демонстрационные услуги выбранной клиники.';
  const list = isVisitPage ? $('#appointmentList') : $('#serviceList');
  list.replaceChildren();
  setEmpty('Загрузка…');
  try {
    if (isVisitPage) {
      const rows = await get(supabase.from('appointments')
        .select('id,visit_date,visit_time,note,status,patient_name,doctor:doctors(name),service:services(name)')
        .order('visit_date').order('visit_time'));
      if (version !== renderVersion) return;
      appointments = rows;
      drawAppointments();
    } else {
      const rows = await get(supabase.from('services').select('name,price')
        .eq('clinic_id', account.clinic_id).order('name'));
      if (version !== renderVersion) return;
      for (const row of rows) {
        const card = document.createElement('article');
        card.className = 'item-card';
        writeText(card, 'div', 'item-title', row.name);
        writeText(card, 'span', 'status', row.price);
        list.append(card);
      }
      setEmpty(rows.length ? '' : 'Услуг пока нет');
    }
  } catch (error) {
    if (version === renderVersion) setEmpty('Не удалось загрузить данные', failure(error));
  }
}

function drawAppointments() {
  if (!account || page !== 'appointments') return;
  $('#appointmentCount').textContent = appointments.length;
  const filter = account.isDoctor ? $('#appointmentFilter').value : 'all';
  const list = $('#appointmentList');
  list.replaceChildren();
  if (account.isDoctor) {
    const counts = { 'Новая': '#newCount', 'Подтверждена': '#confirmedCount', 'Завершена': '#doneCount' };
    for (const [status, selector] of Object.entries(counts)) {
      $(selector).textContent = appointments.filter(row => row.status === status).length;
    }
  }
  const rows = filter === 'all' ? appointments : appointments.filter(row => row.status === filter);
  setEmpty(rows.length ? '' : (appointments.length ? 'Нет заявок с таким статусом' : 'Заявок пока нет'));
  for (const row of rows) {
    const card = document.createElement('article');
    card.className = 'item-card';
    const info = writeText(card, 'div', 'item-main', '');
    const date = row.visit_date.split('-').reverse().join('.');
    const service = row.service ? ' · ' + row.service.name : '';
    writeText(info, 'div', 'item-title', date + ' · ' + row.visit_time.slice(0, 5) + service);
    writeText(info, 'div', 'item-sub', account.isDoctor ? 'Пациент: ' + row.patient_name : 'Врач: ' + row.doctor.name);
    if (row.note) writeText(info, 'div', 'item-sub', row.note);
    writeText(card, 'span', 'status ' + (statusLabels[row.status] || ''), row.status);
    const transitions = [];
    if (account.isDoctor && row.status === 'Новая') transitions.push(['Подтвердить', 'Подтверждена']);
    if (account.isDoctor && row.status === 'Подтверждена') transitions.push(['Завершить', 'Завершена']);
    if (row.status === 'Новая' || row.status === 'Подтверждена') transitions.push(['Отменить', 'Отменена']);
    if (transitions.length) {
      const actions = writeText(card, 'div', 'card-actions', '');
      for (const [label, status] of transitions) {
        const button = writeText(actions, 'button', 'small-btn', label);
        button.addEventListener('click', async () => {
          for (const item of actions.children) item.disabled = true;
          try {
            const result = await get(supabase.from('appointments').update({ status })
              .eq('id', row.id).eq('status', row.status).select('id').maybeSingle());
            feedback(result ? 'Статус заявки обновлён.' : 'Заявка уже изменилась. Список обновлён.');
            if (page === 'appointments') await openPage('appointments');
          } catch (error) {
            feedback(failure(error));
          } finally {
            for (const item of actions.children) item.disabled = false;
          }
        });
      }
    }
    list.append(card);
  }
}

function onSubmit(selector, callback, errorSelector = '#authMessage') {
  $(selector).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    if (errorSelector === '#authMessage') feedback('', errorSelector);
    try {
      await callback(Object.fromEntries(new FormData(form)));
      form.reset();
    } catch (error) {
      feedback(failure(error), errorSelector);
    } finally {
      button.disabled = false;
    }
  });
}

async function initialise() {
  for (const button of $$('.tab')) button.addEventListener('click', () => setTab(button.dataset.tab));
  for (const button of $$('.navitem')) button.addEventListener('click', () => openPage(button.dataset.page));
  $('#appointmentFilter').addEventListener('change', drawAppointments);
  for (const form of ['#loginForm', '#patientForm']) $(form).querySelector('button').disabled = true;
  try {
    const response = await fetch('./config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Подключение к облачной базе ещё настраивается.');
    const config = await response.json();
    if (!config.url || !config.key) throw new Error('Подключение к облачной базе ещё настраивается.');
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm');
    supabase = createClient(config.url, config.key);
  } catch (error) {
    feedback(location.protocol === 'file:' ? 'Откройте MedFlow по ссылке GitHub Pages.' : failure(error), '#setupMessage');
    return;
  }

  onSubmit('#loginForm', async values => {
    const data = await get(supabase.auth.signInWithPassword({ email: values.email.trim(), password: values.password }));
    await showAccount(data.user);
  });
  onSubmit('#patientForm', async values => {
    const name = values.name.trim();
    if (!name) throw new Error('Укажите имя.');
    const data = await get(supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: { data: { name } },
    }));
    if (!data.session) throw new Error('Supabase ожидает подтверждения email. Для демо требуется отключить подтверждение.');
    await showAccount(data.user);
  });
  onSubmit('#appointmentForm', async values => {
    await get(supabase.from('appointments').insert({
      doctor_id: Number(values.doctor),
      service_id: values.service ? Number(values.service) : null,
      visit_date: values.date,
      visit_time: values.time,
      note: values.note.trim(),
    }));
    feedback('Заявка сохранена.');
    await openPage('appointments');
  }, '#toast');
  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await get(supabase.auth.signOut({ scope: 'local' }));
      showAuth();
      setTab('login');
    } catch (error) {
      feedback(failure(error));
    }
  });
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showAuth();
  });

  for (const form of ['#loginForm', '#patientForm']) $(form).querySelector('button').disabled = false;
  try {
    const { session } = await get(supabase.auth.getSession());
    if (session) await showAccount(session.user);
  } catch (error) {
    feedback(failure(error), '#authMessage');
  }
}

initialise();
