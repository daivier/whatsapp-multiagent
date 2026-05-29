# Monitoring

## Healthcheck (UptimeRobot / Better Stack)

Backend já expõe `GET /health` sem autenticação. Devolve `200` se OK e `503` se a BD estiver inacessível. Body JSON:

```json
{
  "ok": true,
  "db": "ok",
  "whatsapp": { "ready": true, "hasQr": false },
  "push": "configured",
  "transcribe": "configured",
  "uptime_seconds": 1234,
  "version": "1.0.0",
  "timestamp": "2026-05-29T..."
}
```

### URLs a monitorizar (uma por tenant)

| Tenant | URL |
|---|---|
| supermercados | https://atendimento.supermercadosfortaleza.com.br/health |
| sucataodejeova | https://diaadia.code2scan.com/health |
| diaristou | https://atendimento.diaristou.com.br/health |
| sac-supermercados | https://atendimentosac.supermercadosfortaleza.com.br/health |

### Setup UptimeRobot (gratuito até 50 monitores)

1. Cria conta em https://uptimerobot.com
2. **New Monitor** → tipo **HTTPS** → URL acima → intervalo **5 min** (free) ou **1 min** (paid)
3. Alert contacts → adicionar e-mail / SMS / Slack / Telegram
4. Repete para cada tenant

### Setup Better Stack (mais features, plano gratuito)

1. https://betterstack.com/uptime → Create monitor → URL acima
2. Check interval 1 min (free)
3. Adicionar Status Page público se quiseres mostrar uptime aos clientes (`status.suaempresa.com.br`)

### Validação local que o endpoint funciona

```bash
curl -i https://diaadia.code2scan.com/health
```

Deve devolver `HTTP/1.1 200 OK` e o JSON acima.

---

## Métricas Prometheus

Backend expõe `GET /metrics` (sem auth — protege via nginx allowlist se quiseres).

### Métricas disponíveis

- `whatsapp_messages_total{direction,line_id,has_media}` — counter
- `whatsapp_conversations_active{status}` — gauge (refresh 15s)
- `whatsapp_line_connected{line_id,line_name}` — gauge 0/1
- `whatsapp_send_duration_seconds{line_id}` — histogram
- `whatsapp_transcribe_total{outcome}` — counter (ok / error / empty / disabled)
- `whatsapp_push_sent_total{outcome}` — counter (ok / error / expired)
- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds{method,route}` — histogram
- `node_*` — métricas default Node.js (CPU, memory, event loop)

### Scrape via Prometheus

```yaml
# /etc/prometheus/prometheus.yml
scrape_configs:
  - job_name: 'whatsapp-multiagent'
    scrape_interval: 15s
    static_configs:
      - targets:
          - 'supermercados.local:3002'   # ou via nginx interno
          - 'sucataodejeova.local:3005'
          - 'diaristou.local:3006'
        labels:
          tenant: 'shared'
```

### Restringir acesso a /metrics

Adicionar no nginx vhost:

```nginx
location /metrics {
    allow 10.0.0.0/8;        # IPs do Prometheus
    allow 127.0.0.1;
    deny all;
    proxy_pass http://localhost:3005;
}
```

### Dashboards Grafana sugeridos

- **Operacional**: line_connected por tenant + msgs/seg em rate de 5min + p99 send_duration
- **Negócio**: msgs out/in por tenant/dia + conversations_active stacked area
- **Saúde**: push_sent error rate + transcribe error rate + HTTP 5xx rate
- **Capacidade**: node_heap_used_bytes + node_eventloop_lag_seconds

---

## Audit log

Backend regista acções sensíveis em `audit_log`:

- `conversation.transfer`, `conversation.delete`, `conversation.bulk_delete`
- `contact.delete`, `contact.cleanup_invalid`
- `blacklist.add`, `blacklist.remove`
- `user.role_change`
- `broadcast.send`

Consulta via `GET /audit` (owner only). Filtros: `action`, `user_id`, `target_type`, `target_id`, `from`, `to`, `limit` (max 500).

```bash
# Últimas 50 entradas de blacklist
curl -H "Authorization: Bearer $TOKEN" 'https://diaadia.code2scan.com/audit?action=blacklist.add&limit=50'
```
