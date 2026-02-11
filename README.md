# qaq-checkin

[GGBOOM 公益站](https://sign.qaq.al) 自动签到脚本，通过 WASM PoW（工作量证明）求解完成每日签到任务。

## 功能

- 自动检测当日签到状态，已签到则跳过
- WASM 引擎进行本地 PoW 基准测试，计算哈希速率（HPS）
- 根据服务端下发的难度挑战，暴力求解满足条件的 nonce
- 提交求解结果完成签到
- 支持 `challenge-only` 和 `full` 两种运行模式
- 签到结果通过 [PushPlus](https://www.pushplus.plus/) 推送通知（可选）
- 通过 GitHub Actions 定时自动执行（每日 UTC 00:10）

## 使用

### 本地运行

```bash
pnpm install
pnpm run checkin
```

### GitHub Actions

项目已配置 `.github/workflows/checkin.yml`，支持定时触发和手动触发。

需要在仓库 **Settings > Secrets and variables > Actions** 中配置以下 Secrets：

| Secret | 说明 | 示例 |
|---|---|---|
| `COOKIE` | 登录 Cookie（包含 sid 和 cf_clearance） | `sid=xxx; cf_clearance=xxx` |
| `PUSHPLUS_TOKEN` | PushPlus 推送 Token（可选） | 在 [pushplus.plus](https://www.pushplus.plus/) 获取 |

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `COOKIE` | **[必填]** 登录凭证（包含 sid 和 cf_clearance） | - |
| `BASE_URL` | 签到服务地址 | `https://sign.qaq.al` |
| `POW_WASM_URL` | WASM 文件地址 | `${BASE_URL}/wasm/pow.wasm` |
| `TIER` | 签到等级 | `4` |
| `MODE` | 运行模式（`full` / `challenge-only`） | `challenge-only` |
| `BENCH_ROUNDS` | 基准测试轮数 | `3` |
| `BENCH_DURATION_MS` | 单轮基准测试时长（ms） | `1200` |
| `MAX_POW_SECONDS` | PoW 求解超时时间（s） | `300` |
| `MIN_SUBMIT_DELAY_MS` | 提交最小延迟（ms） | `60000` |
| `HPS` | **[可选]** 手动指定哈希速率，跳过基准测试 | - |
| `PUSHPLUS_TOKEN` | **[可选]** PushPlus 推送 Token | - |

## 技术栈

- TypeScript + Node.js 20
- WebAssembly（PoW 哈希计算）
- pnpm 9
- GitHub Actions
