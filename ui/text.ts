// What the page says for the API's codes (docs/openapi.yaml). The API speaks English codes; the page
// speaks Russian — a code not listed here falls back to the API's own message.

export const ACCOUNT_STATE: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  pending: ['подключается', 'neutral'],
  bootstrap_lost: ['подключение прервано', 'danger'],
  connected: ['токен есть, воркер не установлен', 'warning'],
  installing: ['устанавливается', 'neutral'],
  ready: ['работает', 'success'],
  permission_error: ['не хватает прав', 'danger'],
  revoked: ['токен отозван', 'danger'],
  resource_drift: ['воркер изменён вне clx', 'danger'],
  no_connection: ['нет связи с воркером', 'warning'],
};

export const STEP: Record<string, string> = {
  reserved: 'начинаем',
  catalog: 'проверяем права bootstrap-токена',
  token_stored: 'рабочий токен выпущен',
  probed: 'рабочий токен проверен',
  d1_creating: 'создаём базу',
  d1: 'база готова',
  migrated: 'схема базы применена',
  uploading: 'загружаем воркер',
  uploaded: 'воркер загружен',
  selfcheck: 'ждём отклика воркера',
  unconfirmed: 'воркер работает, отклика пока нет',
  done: 'готово',
  superseded: 'заменено новой операцией',
};

export const OPERATION: Record<string, string> = { connect: 'Подключение', renew: 'Обновление токена', install: 'Установка', update: 'Обновление воркера', disconnect: 'Отключение' };

const ERROR: Record<string, string> = {
  unauthorized: 'Нужно войти заново.',
  invalid_request: 'Проверьте введённые данные.',
  not_found: 'Не найдено.',
  limit_reached: 'Достигнут предел вашего тарифа.',
  payload_too_large: 'Слишком большой запрос.',
  idempotency_conflict: 'Повтор запроса с другими данными — обновите страницу и попробуйте снова.',
  scope_required: 'Не хватает прав для этого действия.',
  session_required: 'Это действие доступно только со страницы clx.cx.',
  key_already_issued: 'Ключ по этому запросу уже выпущен, но ответ потерялся — отзовите его в списке и выпустите новый.',
  not_configured: 'Сервис ещё не настроен.',
  zone_not_found: 'В аккаунте нет зоны для этого хоста.',
  site_exists: 'Такой сайт уже добавлен.',
  link_host_required: 'Сначала задайте хост ссылок этого аккаунта.',
  link_exists: 'Такой код уже занят другой ссылкой этого аккаунта.',
  route_conflict: 'На этом пути уже стоит другой воркер.',
  site_not_active: 'Сайт ещё не активен.',
  route_not_ours: 'Маршрут clx изменили вне clx — он оставлен как есть.',
  storage_limit: 'Превышен объём настроек аккаунта.',
  service_full: 'Подключение новых аккаунтов временно закрыто — места закончились.',
  operation_in_progress: 'С этим аккаунтом уже идёт операция. Подождите и обновите страницу.',
  plan_required: 'Нужен тариф api.',
  account_taken: 'Этот аккаунт Cloudflare подключён другим пользователем clx.',
  already_connected: 'Этот аккаунт Cloudflare уже подключён.',
  account_not_ready: 'Аккаунт ещё не готов.',
  invalid_bootstrap: 'Bootstrap-токен не подошёл: проверьте, что он скопирован целиком и не истёк.',
  bootstrap_permission_error: 'У bootstrap-токена не те права: нужны Account Settings Read и Account API Tokens Write.',
  permission_catalog: 'Cloudflare не отдал список прав. Попробуйте ещё раз.',
  orphan_not_deleted: 'Не удалось удалить токен от прошлой попытки — удалите его в Cloudflare вручную.',
  token_rights_mismatch: 'Выпущенный токен получил не те права. Попробуйте ещё раз.',
  token_check_failed: 'Не удалось проверить рабочий токен. Попробуйте ещё раз.',
  renew_lost: 'Обновление токена прервалось. Попробуйте ещё раз.',
  rate_limited: 'Слишком много запросов. Подождите минуту.',
  cloudflare_unavailable: 'Cloudflare сейчас не отвечает как надо. Попробуйте через минуту.',
  name_taken: 'В аккаунте уже есть чужой воркер с именем clx-edge — clx его не трогает.',
  resource_drift: 'Воркер clx-edge изменён вне clx.',
  cron_limit: 'В аккаунте закончились кроны (на Free их 5).',
  permission_error: 'У рабочего токена не хватает прав.',
  revoked: 'Рабочий токен отозван.',
  self_check_timeout: 'Воркер не откликнулся вовремя.',
  credentials_missing: 'Токен аккаунта потерян на стороне clx — подключите аккаунт заново.',
  credentials_unreadable: 'clx не может прочитать сохранённый токен — подключите аккаунт заново.',
  cloudflare_error: 'Cloudflare вернул ошибку.',
  internal: 'Что-то пошло не так на нашей стороне. Попробуйте ещё раз.',
};

const WARNING: Record<string, string> = {
  not_confirmed: 'воркер пока не подтвердил запуск — проверим по его первым отправкам',
  bootstrap_long_lived: 'bootstrap-токен был выпущен надолго — лучше на сутки',
  bootstrap_not_deleted: 'bootstrap-токен не удалился — удалите его в Cloudflare',
};

export const errorText = (code: string | undefined, fallback: string) => (code && ERROR[code]) || fallback;
export const warningText = (w: string) => {
  const [code, arg] = w.split(':');
  if (code === 'old_token_not_deleted') return `старый рабочий токен ${arg ?? ''} не удалился — удалите его в Cloudflare`;
  return WARNING[code!] ?? w;
};

export const ADVICE_LEVEL: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  ok: ['запас есть', 'success'],
  watch: ['стоит присмотреть', 'neutral'],
  upgrade_soon: ['скоро нужен Workers Paid', 'warning'],
  over: ['лимит Free исчерпан', 'danger'],
};
export const METRIC: Record<string, string> = { requests: 'Запросы к воркерам за сутки', writes: 'Записи D1 за сутки', reads: 'Чтения D1 за сутки', size: 'Размер базы clx-edge' };
export const DROP: Record<string, string> = { budget: 'сверх бюджета', invalid: 'неверные', unknown_target: 'неизвестный сайт', too_old: 'слишком старые', busy: 'clx.cx был занят', expired: 'устарели в очереди' };
export const SCOPE: Record<string, string> = { accounts: 'аккаунты', sites: 'сайты', links: 'ссылки', reports: 'отчёты' };
