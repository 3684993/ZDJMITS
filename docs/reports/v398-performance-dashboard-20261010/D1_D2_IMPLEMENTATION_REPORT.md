# D1/D2 implementation and validation
从 PR31 实际 HEAD f4287f3cad89da09d54254df8f4f0c4d4df25848 开始，先 fetch origin，再在 D:/MITS-WORKTREES/v398-performance-dashboard 独立 worktree 工作。常规 merge origin/main b55f427 同步权威 ABORTED；未合并网络 PR25/27/29。原工作目录和 D:/MITS dirty 保留。

## RED / FIX / GREEN
原 ChatGPT 源码 npm ci、指定主机/灯单测7/7、verify:ci 全部成功；未虚构原编译缺陷。原 HEAD hosted CI38014712415 success。历史文件 targeted-red.log/verify-ci-red.log 名称为工作阶段标签，内容实际 GREEN。
新增 Vue 组件回归 component-red.log：过期42%仍显示以及跨币种无类型利润混加。修复当前数据失败/过期清空、typed合同、真实 request budget 字段与未知值语义。后续针对测试 GREEN。
截图发现首屏 now 初始化早于 API asOf，误灰到下一轮；已在 load 完成更新 now，重新截图。
扩展主机 OS异常和缓存不可变；GPU有界校验/单飞/实例；资金阈值/重复币种/过期；Vue销毁/隐藏/断连/不混币种。最终 npm run verify:ci 日志 verify-ci-final.log；最终精确 source CI 另见 github-actions-*.json/GitHub PR，不借其他 ref CI。
npm ci 原依赖279 packages；既有审计4项(2 moderate,2 critical)，未执行 force audit fix。verify 已涵盖脚本、自测、S00、typecheck、build、contracts/core/dashboard、Engine4 shards。机械生成 S00 inventory 保留；无绕过。

## 实码
新增 GPU reader、contracts schema、外部只读 counter/LUID/model identity collector；host API增强cache/source/window。Vue驾驶舱展示主机、三模型、GPU进程卡/趋势、网络灯、真实请求预算、private与未知TP/收益事实。资金图表按币种阈值着色，收益/未实现趋势、资金归因覆盖。15秒可见轮询、8秒中止、gap null、实例断点、ECharts释放。
离线 Edge 浏览器截图无真实账户数据，1440/390宽无overflow/pageerror；明确fixture水印。11个canvas，browser-qa.json含负载。renderMs包含600ms等待/静态服务启动路径，不能当线上帧耗时或相对优化。collector collectionMs 会单独披露，是总墙钟而非 CPU；采样在独立进程，不参与核心tick。

## 性能与限制
尚未部署，线上前后推理/CPU/收益改善 UNKNOWN。真实自然基线是原 runtime 行为；容量租约独立PR的100-job离线模拟 Primary queue P95 4140→1520ms（63.3%），Review overdue0→0、失败0→0、80 Primary/20 Review数量相同、授权0→0，不是实际交易授权或GPU吞吐证明。
来源不足的 TP全链路漏斗、回撤、精确7d P95、SSH wire bytes、llama eval tokens/s保持UNKNOWN。没有新增真实TP改价、补仓、Entry权限或交换写。25/25签名TP仅02:10Z样本，门禁未全闭合，未部署未重启，新24h未开启。

