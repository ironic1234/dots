---
name: robinhood-management
description: Manage Robinhood account tasks including portfolio checks, quotes, watchlists, orders, options, scanners, earnings, and realized P&L using Robinhood MCP tools. Use for any user request involving Robinhood, brokerage accounts, stocks/options trading, watchlists, scans/screeners, portfolio value, orders, positions, or market data from Robinhood.
---

# Robinhood Management Skill

Use this skill whenever the user asks to inspect or manage their Robinhood account, portfolio, positions, orders, watchlists, scanners/screeners, earnings, quotes, or options.

## Core safety rules

- Treat Robinhood write actions as real account changes.
- Never place, cancel, exercise, add/remove watchlist items, create/update scans, or create/update/follow/unfollow watchlists without explicit user confirmation immediately before the tool call.
- For trading actions, review first unless the user very explicitly says to skip review (for example: “skip the review” or “just place it, don’t review”). A generic “place this order” is not a review bypass.
- Do not give personalized financial advice. Provide factual account/market data, order mechanics, risks surfaced by tools, and neutral explanations.
- If multiple brokerage accounts exist and the user did not specify one, list accounts and ask which account to use. Do not default to an account for orders, positions, orders history, portfolio, or P&L.
- Never call placing/canceling/exercising tools for accounts where `agentic_allowed` is false.
- For option orders/exercises, verify account options level is `option_level_2` or `option_level_3` before proceeding.

## Read-only workflows

### Portfolio / buying power

Use `robinhood_get_accounts` to identify accounts if needed, then `robinhood_get_portfolio` for account value, buying power, and asset breakdown.

### Positions

- Equity positions: `robinhood_get_equity_positions`
- Option positions: `robinhood_get_option_positions` with `nonzero=true` for currently open options.

### Orders

- If the user asks for “orders” without specifying equities/options, call both `robinhood_get_equity_orders` and `robinhood_get_option_orders`.
- Prefer narrow filters (`state`, `symbol`, `created_at_gte`) when the request is specific.
- Use the user’s timezone for relative dates, then convert to UTC when needed.

### Quotes / fundamentals / history / earnings

- Real-time equity quote: `robinhood_get_equity_quotes`
- Fundamentals: `robinhood_get_equity_fundamentals`
- Historical bars: `robinhood_get_equity_historicals`
- Specific ticker earnings: `robinhood_get_earnings_results`
- Market-wide earnings calendar: `robinhood_get_earnings_calendar`
- Index lookup: `robinhood_get_indexes`, then `robinhood_get_index_quotes`

### Realized P&L

Use `robinhood_get_realized_pnl`. Default span is acceptable if the user asks generally; otherwise use the requested span or date range.

## Equity order workflow

1. Confirm account and check `agentic_allowed=true` via `robinhood_get_accounts`.
2. Ensure required order details are known:
    - symbol
    - buy/sell
    - order type (`market`, `limit`, `stop_market`, `stop_limit`)
    - quantity or dollar amount, exactly one
    - limit/stop prices if required
    - time in force and market hours if relevant
3. If not skipping review, call `robinhood_review_equity_order`.
4. Present estimated cost/proceeds and alerts clearly.
5. Ask for explicit confirmation to place.
6. On confirmation, call `robinhood_place_equity_order` with the same parameters and a fresh UUID `ref_id`.

## Option order workflow

1. Confirm account and verify `agentic_allowed=true` plus `option_level_2` or `option_level_3`.
2. Resolve contract:
    - `robinhood_get_option_chains`
    - `robinhood_get_option_instruments` filtered by expiration, strike, and call/put
    - `robinhood_get_option_quotes` when quote context is useful
3. Only single-leg option orders are supported.
4. Ensure required details are known:
    - buy/sell
    - open/close
    - quantity
    - order type
    - limit/stop price if required
    - time in force and market hours if relevant
5. If not skipping review, call `robinhood_review_option_order`.
6. Present alerts, fees, collateral, and quote information.
7. Ask for explicit confirmation to place.
8. On confirmation, call `robinhood_place_option_order` with the same parameters and a fresh UUID `ref_id`.

## Cancel order workflow

- Resolve the order ID with `robinhood_get_equity_orders` or `robinhood_get_option_orders` if the user refers to an order by symbol or description.
- Confirm account ownership and `agentic_allowed=true`.
- Ask explicit confirmation before canceling.
- Use `robinhood_cancel_equity_order` or `robinhood_cancel_option_order`.

## Option exercise workflow

Before exercise:

1. Use `robinhood_get_option_positions` to confirm the position is long and quantity is available.
2. Use `robinhood_get_accounts` to confirm `agentic_allowed=true` and options level 2/3.
3. Reject/stop if it is an index option; index options cannot be manually exercised.
4. Ask explicit confirmation. State that exercise may become irrevocable after it moves past queued.
5. For put exercises with insufficient shares, only set `allow_shorts=true` after explicit confirmation that the user intends to create a short equity position.

## Watchlists

- Read watchlists: `robinhood_get_watchlists`, then `robinhood_get_watchlist_items`.
- Options watchlist: use `robinhood_get_option_watchlist` instead of generic watchlist items.
- Add/remove stocks, crypto pairs, or indexes only after explicit confirmation.
- For options watchlist, resolve contracts with `robinhood_get_option_instruments` and use option-specific add/remove tools.
- For curated lists, use follow/unfollow tools only after confirmation.

## Scanners / screeners

- List saved scans: `robinhood_get_scans`.
- Run scan: `robinhood_run_scan` and present results as a table; mention results are live.
- Create/update scans only after explicit confirmation because they change saved account state.
- Do not modify Cortex-managed scans.
- `robinhood_update_scan_filters` replaces all filters; when adding a filter, first read the existing filters and send the full new set.

## Response style

- Be concise and clearly separate: data retrieved, warnings/alerts, next action needed.
- For confirmations, summarize the exact action and key parameters, then ask a yes/no confirmation.
- For placed/canceled/exercised actions, report returned status and IDs.
- For market data, include timestamps/session context when returned by tools.
