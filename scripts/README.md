# Development scripts

Not part of the application. Run them with `npx tsx scripts/<name>.ts`.

| Script | What it does |
|---|---|
| `dump_ts.ts` | Dumps every engine decision (My Day, health, pipeline, per-account next action / activity check / firewall verdict, readiness, SLA state) as JSON. |
| `dump_py.py` | The same dump from the frozen Python reference implementation under `python/`. |
| `mint_session.ts` | Mints a session cookie for a role, so pages can be smoke-tested with `curl` without driving a browser. Local database access only — it is a dev convenience, not an auth bypass you can reach over the network. |

## Re-verifying the port

If you change `src/lib/engine.ts` or the rules and want to confirm the behaviour still
matches the V0.1 reference:

```bash
npm run seed
python3 scripts/dump_py.py > /tmp/py.json
npx tsx scripts/dump_ts.ts   > /tmp/ts.json
diff <(python3 -m json.tool --sort-keys /tmp/py.json) \
     <(python3 -m json.tool --sort-keys /tmp/ts.json)
```

Empty diff means the two engines make identical decisions. That is how this port was
checked: 38 accounts, 15 readiness records and every task, byte for byte.

Once you deliberately change behaviour, the Python reference stops being the oracle —
update `tests/acceptance.mts` instead and retire this comparison.
