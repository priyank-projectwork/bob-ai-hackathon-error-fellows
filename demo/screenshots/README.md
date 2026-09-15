# Screenshots — SupplyChain AI Copilot

3 screenshots of the running application.

## Files

- `01-dashboard-kpis.png` — Full dashboard on initial load: 4 KPI cards, live sensor feed, idle fleet assets
- `02-disruption-impact.png` — After triggering LA Port Strike: AI Action Center populated with ranked recommendations, disruption zone on map
- `03-cold-chain-alerts.png` — Cold-chain excursion alerts active + Audit Trail section showing approved recommendation events

## How to reproduce

```bash
cd src/backend && npm install && npm run seed && npm start
cd src/frontend && npm install && npm run dev
```

Open http://localhost:3000
