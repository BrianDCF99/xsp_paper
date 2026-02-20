# xsp_paper

Standalone paper-trading runner for **Extreme Sell Pressure v16**.

- Fresh strategy implementation (no reuse of runner strategy code)
- DB-first state (Supabase)
- Telegram alerts on every entry and every exit
- Config-driven from `config/config.yaml`
- Secrets from `.env`
- Command startup: `npm run dev` (no CLI args)

## Strategy (v16)

Entry confirmation is **close-confirm / next-open entry**:

- Sell Ratio <= `strategy.sellRatioMax`
- 1h Volume >= `strategy.minHourVolume`
- Both confirmed on closed hourly candle
- Entry at next candle open price (paper fill)

Exits:

1. Liquidation
2. Take Profit
3. Delta Exit (`current_sell_ratio - entry_sell_ratio >= deltaExitThreshold`)
4. Time Exit (if `maxHoldHours > 0`)

Portfolio controls:

- Max open positions
- Duplicate-symbol guard
- Replacement threshold (`unlevered` or `levered` basis)
- Dynamic margin = `min(current_equity * entryMarginFraction, entryMarginCapUsd, cash)`
- Restart-safe downtime reconciliation for open positions (exit-only)

Costs model (config toggles):

- Fees: on/off
- Slippage: on/off

## Project Structure

- `src/config`: config loading and validation
- `src/infra/bybit`: Bybit API adapter
- `src/infra/db`: Supabase repositories
- `src/infra/telegram`: Telegram sender + command polling
- `src/strategy/v16`: strategy detector, execution, messages
- `src/services`: scheduler and command service
- `sql`: Supabase schema/functions

## Setup

1. Install deps

```bash
npm install
```

2. Create `.env`

```bash
cp .env.example .env
```

3. Configure `config/config.yaml`

4. Apply SQL in Supabase SQL editor

- `sql/001_schema.sql`
- `sql/002_views_and_functions.sql`

5. Run

```bash
npm run dev
```

## Telegram Commands

- `/xsp` => live summary + open positions
- `/scan` => manual scan cycle
- `/help`

## Notes

- Summaries are always computed from DB (`xsp_summary`), not local memory.
- Alerts are persisted in `xsp_alerts`.
- Telegram send failures are logged.
- Entry backfills are intentionally disabled; only open-position exits are reconciled after restart.
