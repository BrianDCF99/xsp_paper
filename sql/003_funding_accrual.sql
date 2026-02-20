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
