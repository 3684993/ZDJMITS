# V3 基础设施与部署计划

## 服务拓扑

```text
Browser :5173(dev) / :8080(prod)
   |
   +-- /api/v3 + /ws
   v
ZDJ Engine :8080
   |-- Market Data Hub
   |-- Universe / Pool
   |-- EIP Builder
   |-- AI Fabric
   |    |-- :8081 B580 / Qwen3.5-9B
   |    |-- :8082 7900-A / Qwen3.8-27B
   |    +-- :8083 7900-B / Qwen3.8-27B
   |-- Entry Manager
   |-- Position / TP Guardian
   |-- Reconciliation
   +-- Persistence / Audit
```

## 开发模式

- Engine: 127.0.0.1:8080
- Vue/Vite: 127.0.0.1:5173
- Vite `/api` 与 `/ws` 代理到 Engine
- `ZDJ_DATA_MODE=mock`
- `ZDJ_AI_MODE=mock`
- `ZDJ_TRADING_ADAPTER=mock`

## GPU 模式

- 8081: B580 / 9B Scout
- 8082: 7900-A / 27B Brain
- 8083: 7900-B / 27B Brain
- 所有 endpoint 只允许 Engine 访问；浏览器不直连。

## 生产进程

建议最终拆为：
- `zdj-engine`
- `zdj-dashboard` 静态文件由 engine/reverse proxy 托管
- 三个独立模型进程
- 单独 watchdog / service manager

Windows 可使用 NSSM / WinSW / Task Scheduler 中任一成熟方式；Codex 阶段根据目标主机实际环境选择并记录。

## 数据与备份

生产持久化目录：
- `data/state.db`
- `data/audit/`
- `data/logs/`
- `data/backups/`

数据库必须启用事务、WAL、定时 checkpoint、备份与启动完整性检查。

## 网络

- Engine 与模型：localhost
- Engine 与 Binance：统一代理/直连策略
- DNS 与 TLS 证书必须在启动自检中验证
- 不允许浏览器获取交易所 Secret

## 观测

至少记录：
- universe refresh duration
- pool replenishment count
- EIP build latency/completeness
- 9B/27B queue wait/latency/input/output tokens
- Brain decisions/reject ratio/review ratio
- entry reachability/reprice/TTL
- fill latency
- TP protection latency/missing count
- reconciliation drift
- REST/WS errors
- process memory/CPU/GPU health
