-- Esquema inicial de la base de datos comercial.
-- No contiene la base de licencias: solo referencias a las licencias del sistema actual.

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email             text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash     text NOT NULL,
  email_verified_at timestamptz,
  role              text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id           text PRIMARY KEY,               -- sha256 del token de la cookie
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  ip         text,
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at);

CREATE TABLE products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,64}$'),
  name                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  platform            text NOT NULL,                    -- p. ej. "NinjaTrader 8"
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  license_product_ref text,                             -- identificador del producto en el sistema de licencias
  activation_policy   text NOT NULL DEFAULT '',         -- texto libre: máquinas permitidas, HWID, etc.
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id),
  name             text NOT NULL,
  price_cents      integer NOT NULL CHECK (price_cents > 0),
  currency         char(3) NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('day', 'week', 'month', 'year')),
  interval_count   integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  grace_days       integer NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 30),
  paypal_plan_id   text UNIQUE,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_product_idx ON plans (product_id);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id),
  product_id             uuid NOT NULL REFERENCES products(id),
  plan_id                uuid NOT NULL REFERENCES plans(id),
  paypal_subscription_id text UNIQUE,
  provider_status        text,                    -- último estado leído de la API de PayPal
  status                 text NOT NULL DEFAULT 'approval_pending' CHECK (status IN (
                           'approval_pending', 'active', 'grace', 'payment_pending',
                           'unpaid', 'suspended', 'canceled', 'expired')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  access_until           timestamptz,             -- fin del periodo pagado
  access_revoked_at      timestamptz,             -- reembolso, contracargo o suspensión manual
  revoke_reason          text,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status, access_until);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  subscription_id uuid REFERENCES subscriptions(id),
  provider        text NOT NULL DEFAULT 'paypal',
  provider_txn_id text NOT NULL,                  -- ID de la venta/captura en PayPal
  amount_cents    integer NOT NULL,
  refunded_cents  integer NOT NULL DEFAULT 0,
  currency        char(3) NOT NULL,
  status          text NOT NULL CHECK (status IN (
                    'pending', 'completed', 'failed', 'refunded', 'partially_refunded', 'reversed')),
  payment_type    text NOT NULL CHECK (payment_type IN ('initial', 'renewal')),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_txn_id)
);
CREATE INDEX payments_user_idx ON payments (user_id);
CREATE INDEX payments_paid_idx ON payments (status, paid_at);

CREATE TABLE license_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  product_id          uuid NOT NULL REFERENCES products(id),
  subscription_id     uuid REFERENCES subscriptions(id),
  external_license_id text,                       -- ID en el sistema de licencias actual
  key_ciphertext      text,                       -- clave cifrada (AES-256-GCM), nunca en claro
  key_hint            text,                       -- últimos caracteres, para mostrar sin descifrar
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'active', 'suspended', 'expired', 'revoked')),
  expires_at          timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_license_id)
);
-- una sola licencia viva por cliente y producto: evita duplicados por reintentos
CREATE UNIQUE INDEX license_mappings_live_key ON license_mappings (user_id, product_id) WHERE status <> 'revoked';

CREATE TABLE webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  resource_id       text,
  payload           jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN (
                      'received', 'processed', 'ignored', 'failed')),
  attempts          integer NOT NULL DEFAULT 0,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  error_summary     text,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  idempotency_key text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  run_at          timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'pending';
-- no puede haber dos tareas pendientes iguales; una vez ejecutada, se puede volver a encolar
CREATE UNIQUE INDEX jobs_pending_key ON jobs (idempotency_key) WHERE status = 'pending';

CREATE TABLE email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id),
  to_email            text NOT NULL,
  message_type        text NOT NULL,
  idempotency_key     text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_message_id text,
  attempts            integer NOT NULL DEFAULT 0,
  sent_at             timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_messages_user_idx ON email_messages (user_id);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);

CREATE TABLE support_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
