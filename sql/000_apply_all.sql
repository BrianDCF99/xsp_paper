-- xsp_paper schema (Supabase / Postgres)
-- Apply in order: 001_schema.sql then 002_views_and_functions.sql

create extension if not exists pgcrypto;

create table if not exists xsp_runtime_state (
  key text primary key,
  value_text text,
  value_json jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists xsp_symbols (
  symbol text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists xsp_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  hour_start_ms bigint not null,
  hour_end_ms bigint not null,
  sell_ratio numeric not null,
  hour_volume numeric not null,
  close_price numeric not null,
  next_open_price numeric not null,
  outcome text not null default 'PENDING',
  outcome_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(symbol, hour_start_ms)
);

create index if not exists idx_xsp_signals_symbol on xsp_signals(symbol);
create index if not exists idx_xsp_signals_outcome on xsp_signals(outcome);

create table if not exists xsp_positions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  signal_id uuid references xsp_signals(id) on delete set null,
  status text not null check (status in ('OPEN', 'CLOSED')),

  entry_ts_ms bigint not null,
  signal_hour_start_ms bigint not null,
  entry_price numeric not null,
  entry_sell_ratio numeric not null,
  signal_hour_volume numeric not null,

  leverage numeric not null,
  margin_usd numeric not null,
  notional_usd numeric not null,
  qty numeric not null,

  take_profit_pct numeric not null,
  delta_exit_threshold numeric not null,
  replace_threshold_pct numeric not null,

  latest_mark_price numeric,
  latest_mark_ts_ms bigint,
  latest_unlevered_return_pct numeric,
  latest_leveraged_return_pct numeric,
  latest_unrealized_pnl_usd numeric,

  exit_ts_ms bigint,
  exit_price numeric,
  exit_reason text,
  realized_unlevered_return_pct numeric,
  realized_leveraged_return_pct numeric,
  realized_pnl_usd numeric,
  fees_usd numeric,
  slippage_usd numeric,
  net_funding_fee_usd numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_xsp_positions_status on xsp_positions(status);
create index if not exists idx_xsp_positions_symbol_status on xsp_positions(symbol, status);
create index if not exists idx_xsp_positions_entry_ts on xsp_positions(entry_ts_ms);

create table if not exists xsp_trades (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references xsp_positions(id) on delete cascade,
  symbol text not null,
  exit_ts_ms bigint not null,
  exit_price numeric not null,
  exit_reason text not null,
  unlevered_return_pct numeric not null,
  leveraged_return_pct numeric not null,
  pnl_usd numeric not null,
  fees_usd numeric not null default 0,
  slippage_usd numeric not null default 0,
  net_funding_fee_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_xsp_trades_symbol on xsp_trades(symbol);
create index if not exists idx_xsp_trades_exit_reason on xsp_trades(exit_reason);

create table if not exists xsp_alerts (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  symbol text not null,
  position_id uuid,
  telegram_message_id bigint,
  message_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_xsp_alerts_created_at on xsp_alerts(created_at);
-- Helper objects for DB-driven summaries and command output.

create or replace function xsp_summary(p_starting_equity_usd numeric)
returns table (
  entries bigint,
  live_entries bigint,
  missed_trades bigint,
  winners bigint,
  losers bigint,
  liquidated bigint,
  replaced bigint,
  open_positions bigint,
  cash_usd numeric,
  margin_in_use_usd numeric,
  open_notional_usd numeric,
  unrealized_pnl_usd numeric,
  open_funding_accrued_usd numeric,
  realized_pnl_usd numeric,
  current_equity_usd numeric,
  total_pnl_usd numeric,
  pnl_pct numeric,
  win_pct numeric
)
language sql
stable
as $$
with s as (
  select
    count(*) filter (where outcome in ('MISSED_DUPLICATE','MISSED_CAPACITY','MISSED_NO_CASH','MISSED_INVALID_PRICE')) as missed_trades
  from xsp_signals
),
p as (
  select
    count(*) as entries,
    count(*) filter (where status = 'OPEN') as live_entries,
    count(*) filter (where status = 'OPEN') as open_positions,
    coalesce(sum(margin_usd) filter (where status = 'OPEN'), 0) as margin_in_use_usd,
    coalesce(sum(notional_usd) filter (where status = 'OPEN'), 0) as open_notional_usd,
    coalesce(sum(latest_unrealized_pnl_usd) filter (where status = 'OPEN'), 0) as unrealized_pnl_usd,
    coalesce(sum(latest_funding_accrued_usd) filter (where status = 'OPEN'), 0) as open_funding_accrued_usd
  from xsp_positions
),
t as (
  select
    count(*) filter (where exit_reason in ('TP','DELTA','TIME') and pnl_usd > 0) as winners,
    count(*) filter (where exit_reason in ('TP','DELTA','TIME') and pnl_usd <= 0) as losers,
    count(*) filter (where exit_reason = 'LIQ') as liquidated,
    count(*) filter (where exit_reason = 'REPLACE') as replaced,
    coalesce(sum(pnl_usd), 0) as realized_pnl_usd
  from xsp_trades
),
x as (
  select
    p_starting_equity_usd + t.realized_pnl_usd + p.open_funding_accrued_usd - p.margin_in_use_usd as cash_usd,
    p_starting_equity_usd + t.realized_pnl_usd + p.unrealized_pnl_usd as current_equity_usd
  from p, t
)
select
  p.entries,
  p.live_entries,
  s.missed_trades,
  t.winners,
  t.losers,
  t.liquidated,
  t.replaced,
  p.open_positions,
  x.cash_usd,
  p.margin_in_use_usd,
  p.open_notional_usd,
  p.unrealized_pnl_usd,
  p.open_funding_accrued_usd,
  t.realized_pnl_usd,
  x.current_equity_usd,
  x.current_equity_usd - p_starting_equity_usd as total_pnl_usd,
  case when p_starting_equity_usd > 0 then ((x.current_equity_usd - p_starting_equity_usd) / p_starting_equity_usd) * 100 else 0 end as pnl_pct,
  case when (t.winners + t.losers + t.liquidated) > 0 then (t.winners::numeric / (t.winners + t.losers + t.liquidated)::numeric) * 100 else 0 end as win_pct
from s, p, t, x;
$$;

-- 003_funding_accrual.sql
alter table if exists xsp_positions
  add column if not exists latest_funding_accrued_usd numeric not null default 0;

create or replace function xsp_summary(p_starting_equity_usd numeric)
returns table (
  entries bigint,
  live_entries bigint,
  missed_trades bigint,
  winners bigint,
  losers bigint,
  liquidated bigint,
  replaced bigint,
  open_positions bigint,
  cash_usd numeric,
  margin_in_use_usd numeric,
  open_notional_usd numeric,
  unrealized_pnl_usd numeric,
  open_funding_accrued_usd numeric,
  realized_pnl_usd numeric,
  current_equity_usd numeric,
  total_pnl_usd numeric,
  pnl_pct numeric,
  win_pct numeric
)
language sql
stable
as $$
with s as (
  select
    count(*) filter (where outcome in ('MISSED_DUPLICATE','MISSED_CAPACITY','MISSED_NO_CASH','MISSED_INVALID_PRICE')) as missed_trades
  from xsp_signals
),
p as (
  select
    count(*) as entries,
    count(*) filter (where status = 'OPEN') as live_entries,
    count(*) filter (where status = 'OPEN') as open_positions,
    coalesce(sum(margin_usd) filter (where status = 'OPEN'), 0) as margin_in_use_usd,
    coalesce(sum(notional_usd) filter (where status = 'OPEN'), 0) as open_notional_usd,
    coalesce(sum(latest_unrealized_pnl_usd) filter (where status = 'OPEN'), 0) as unrealized_pnl_usd,
    coalesce(sum(latest_funding_accrued_usd) filter (where status = 'OPEN'), 0) as open_funding_accrued_usd
  from xsp_positions
),
t as (
  select
    count(*) filter (where exit_reason in ('TP','DELTA','TIME') and pnl_usd > 0) as winners,
    count(*) filter (where exit_reason in ('TP','DELTA','TIME') and pnl_usd <= 0) as losers,
    count(*) filter (where exit_reason = 'LIQ') as liquidated,
    count(*) filter (where exit_reason = 'REPLACE') as replaced,
    coalesce(sum(pnl_usd), 0) as realized_pnl_usd
  from xsp_trades
),
x as (
  select
    p_starting_equity_usd + t.realized_pnl_usd + p.open_funding_accrued_usd - p.margin_in_use_usd as cash_usd,
    p_starting_equity_usd + t.realized_pnl_usd + p.unrealized_pnl_usd as current_equity_usd
  from p, t
)
select
  p.entries,
  p.live_entries,
  s.missed_trades,
  t.winners,
  t.losers,
  t.liquidated,
  t.replaced,
  p.open_positions,
  x.cash_usd,
  p.margin_in_use_usd,
  p.open_notional_usd,
  p.unrealized_pnl_usd,
  p.open_funding_accrued_usd,
  t.realized_pnl_usd,
  x.current_equity_usd,
  x.current_equity_usd - p_starting_equity_usd as total_pnl_usd,
  case when p_starting_equity_usd > 0 then ((x.current_equity_usd - p_starting_equity_usd) / p_starting_equity_usd) * 100 else 0 end as pnl_pct,
  case when (t.winners + t.losers + t.liquidated) > 0 then (t.winners::numeric / (t.winners + t.losers + t.liquidated)::numeric) * 100 else 0 end as win_pct
from s, p, t, x;
$$;

create or replace function xsp_open_positions_for_command()
returns table (
  symbol text,
  entry_price numeric,
  leveraged_return_pct numeric,
  entry_ts_ms bigint
)
language sql
stable
as $$
select
  symbol,
  entry_price,
  coalesce(latest_leveraged_return_pct, 0) as leveraged_return_pct,
  entry_ts_ms
from xsp_positions
where status = 'OPEN'
order by entry_ts_ms asc;
$$;
