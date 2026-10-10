# D0 Windows GPU mapping and natural baseline
日期 2026-10-10。事实等级分开列示；本轮没有部署、Engine/model/proxy 重启、人工推理、Settings 修改或订单写入。

## 当前映射
| Duty | Port / PID | GPU | PCI bus/device/function | WDDM LUID |
|---|---|---|---|---|
| Scout | 8081 / 3400 | Intel Arc B580 | 5/0/0 | 0x00000000_0x0000edc6 |
| Review | 8083 / 14020 | RX 7900 XTX | 22/0/0 | 0x00000000_0x000122ec |
| Primary | 8084 / 22336 | RX 7900 XTX | 19/0/0 | 0x00000000_0x0000f452 |

PROVEN：当前监听 PID、进程启动时间、PresentOnly PnP 的三块物理卡、D3DKMT LUID→PCI 地址与 WDDM 每 PID/LUID 显存。STRONG_EVIDENCE：上述主驻留物理卡对应各模型；每个 PID 同时枚举三张卡，不能据枚举顺序宣称独占。初次显存主驻留约 Scout 5.53 GB、Review 17.35 GB、Primary 17.35 GB。公开 API 仍 physicalDeviceIdVerified=false，避免将外部文件当物理权威。
Engine 8080/PID23688、SOCKS 20091/PID18300；监听仅证明本机端口。见 gpu-luid-pci.json、model-identities.json、runtime-readback.json。
映射使用 Microsoft 官方 [OpenAdapterFromLuid](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/nf-d3dkmthk-d3dkmtopenadapterfromluid) 和 [ADAPTERADDRESS](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/ns-d3dkmthk-_d3dkmt_adapteraddress)，只读打开/查询/关闭 handle。

## 模型等价性
实际 GGUF SHA256、模板 SHA256、ctx、alias、配置见 model-identities.json；两份 27B 文件/模板/32768 context 相同。但 Review reasoning=on/output=16384，Primary reasoning=off/output=4096。输出契约等价性 UNKNOWN；因此当前不允许借用。三个命令行都写 Vulkan0，不能据此推同一物理设备。

## 基线方法
独立 PowerShell collector 每15秒读取现有 WDDM 和 Engine 只读 projection，121个样本目标30分钟；不调用模型生成。每60秒刷新监听映射，无同步 CIM/PowerShell 进入 Engine tick。原型因昂贵 counter/HTTP 后额外 sleep 导致约23秒间隔，initial-counter-baseline.json 单独保留，不冒充30分钟窗口。正式窗口及统计在 natural-baseline-summary.json，原始脱敏样本 natural-gpu-baseline.json。运行中的正式 collector 启动在最终 ACL/atomic replacement 编辑之前；最终脚本保护措施由静态解析验证，本轮未重启 collector 来声称已经生效。
GPU 利用率是该 PID 最忙 WDDM engine 百分比，不能当整卡平均；显存是进程 across adapters dedicated/shared bytes。轮询 lastLatency 仅在运行计数变化时统计一次，可能漏掉两个采样间的多个任务。natural-run-timing.json 只含最近100条真实运行的脱敏时序，不能当完整7日或完整基线 P95；没有 llama token-eval 时间所以 tokens/s UNKNOWN。SSH wire bytes、完整 reviewSkipped 原因、精确等待人群仍 UNKNOWN。

## 安全门禁
02:10Z 的一次只读 TESTNET 签名 audit：25个非零仓位、25/25 TP 精确双ID/side/reduceOnly/remaining qty/price PASS；6 GET、audit writes0。signed-tp-sanitized.json 只留哈希和检查，不是当下新鲜证明。official region eligibility、全套批准构建/回滚备份/Production 当前独立闭合仍 UNKNOWN，closeout 两次4/5秒超时样本不能改成成功。没有部署或重启。旧24h仍 ABORTED_SAFETY_FAILURE，不续算；未来正式发布必须全新门禁和完整新24h。

