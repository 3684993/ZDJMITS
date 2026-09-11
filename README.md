# 智多金多币种智能交易系统 V3

V3 是一套以“动态机会竞争 + 专业证据包 + 双主脑并行决策 + 确定性 Maker 执行 + 持仓隔离 + TP 守护”为核心的多币种智能交易系统基础实现。

## 核心流程

```text
Market Data Hub
  -> Universe Selector (Top N)
  -> Eligibility Gate
  -> Opportunity Scoring
  -> Dynamic Trading Pool
  -> B580 / 9B Scout
  -> Entry Intelligence Packet
  -> 7900-A/B / 27B Brain Pool
  -> PLACE_LONG | PLACE_SHORT | REJECT_CANDIDATE
  -> Entry Manager (Maker price)
  -> PENDING_ENTRY
  -> POSITION
  -> TP Guardian
  -> CLOSED -> re-eligible
```

## 默认模型职责

- B580 / Qwen3.5-9B：候选证据整理、缺失检查、摘要；无建仓权限。
- RX 7900 #1 / Qwen3.8-27B：PRIMARY_BRAIN。
- RX 7900 #2 / Qwen3.8-27B：PRIMARY_BRAIN；与 #1 对称并行。

## 运行模式

- `ZDJ_DATA_MODE=mock`：完整模拟行情、选币、AI、挂单、成交、持仓、TP、Dashboard。
- `ZDJ_DATA_MODE=binance-public`：使用 Binance 公共行情接口；交易仍可保持 mock。
- 真实交易写适配器保留接口，必须完成交易所测试网/实盘验收后启用。

## 启动

```bash
npm install
npm run dev
```

Dashboard: `http://127.0.0.1:5173`
Engine API: `http://127.0.0.1:8080/api/v3`

## 关键边界

- 15m 是默认方向主证据；4h / 1d / 1w 只提高权重，不自动禁止逆向。
- AI 决定方向和可接受价格区间；Entry Manager 决定最终 Maker 价格。
- 同一交易对在 `POOL / ANALYZING / PENDING_ENTRY / POSITION` 之间互斥。
- 自动止损不存在于自动执行链；止损保留人工处理。
- TP 由确定性 Position / TP Guardian 管理。
