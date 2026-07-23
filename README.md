# Nyhetsspår

Nyhetsspår 是一个面向 SFI D 之后学习者的瑞典语新闻自学网站。系统每天从公开可读的
SVT、Aftonbladet 和 Dagens Nyheter 页面中选择 2–3 篇新闻，生成每篇 300–500
词的瑞典语学习材料，并提供中英双语释义、难度标注、词汇/词组/固定搭配/语法说明和少量
带来源的原句。系统不会绕过付费墙，也不会转载完整新闻正文。

同一事件即使出现在多家媒体也只会生成一篇主课程；其他公开报道可以作为相关来源显示。
标记为“已掌握”的学习项保存在当前浏览器中，以后的课程会自动隐藏这些标记。

## Local development

需要 Node.js 22 和 pnpm 10。

```bash
pnpm install
pnpm dev
```

打开终端显示的本地网址。日常浏览网站不需要 OpenAI 密钥；密钥只在生成新课程时使用。
不要提交 `.env.local`、API 密钥或抓取到的新闻正文。

## Tests

```bash
pnpm test
pnpm build
pnpm test:e2e
pnpm check:secrets
```

`pnpm check:secrets` 会检查构建产物。部署流程还会单独检查公开课程数据和内部的去重账本。

## Generate a lesson manually

在仓库根目录运行：

```bash
OPENAI_API_KEY="your-key" pnpm pipeline -- --force=true
```

如需明确指定日期，只能使用当前的斯德哥尔摩日期：

```bash
OPENAI_API_KEY="your-key" pnpm pipeline -- --force=true --date=YYYY-MM-DD
```

历史日期回填会被拒绝，避免把今天抓取的新闻错误发布为旧新闻。可以用
`OPENAI_MODEL` 覆盖 `.env.example` 中的默认模型。

## GitHub setup

1. 将仓库推送到一个公开的 GitHub 仓库；公开仓库可使用免费的 GitHub Pages。
2. 打开 **Settings → Pages**，将发布源设为 **GitHub Actions**。
3. 打开 **Settings → Actions → General**，确认工作流可以运行；组织策略如限制写权限，
   需要允许生成任务向 `main` 提交派生课程数据。
4. 在 **Settings → Secrets and variables → Actions → Secrets** 添加仓库密钥
   `OPENAI_API_KEY`。
5. 在同一页面的 **Variables** 添加 `OPENAI_MODEL`；当前默认值为
   `gpt-5.4-mini`。
6. 在 **Actions** 中手动运行一次 **Generate lessons and deploy Pages**。
7. 确认工作流成功部署 `github-pages` 环境，然后打开工作流显示的网址。

定时任务按 `Europe/Stockholm` 时区每天 **07:07** 运行，因此夏令时和冬令时都不需要
调整。普通代码推送也会重新部署网站，但不会调用 OpenAI 或重新抓取新闻。

GitHub Pages 对公开仓库通常不额外收费；私有仓库是否可用取决于 GitHub 套餐，而且
Pages 网站本身是公开网站。OpenAI API 用量单独计费，GitHub 不会代付这部分费用。

## Content and privacy

- 只处理无需登录、无需订阅且 robots 规则允许访问的公开文字文章。
- 新闻全文只在一次生成任务中临时使用，不会提交到 Git、发布到 Pages 或写入日志。
- 公开课程仅包含派生的瑞典语学习文本、摘要、语言标注和少量带来源短句。
- 每篇课程严格验证为 300–500 个瑞典语词，并标注 CEFR 阅读难度，但不按难度筛掉新闻。
- 当天至少同时包含瑞典本地/国内和国际内容；政治、经济、民生、文化和体育按七天记录
  做平衡。
- 同一事件会跨媒体、跨七天去重；只有出现重要新进展时才作为后续报道处理。
- 已掌握内容和阅读进度只保存在当前浏览器。清理浏览器数据前，请先在“已掌握”页面导出
  JSON 备份。

请仍然点击“阅读完整原文”核对新闻语境，并遵守各媒体的使用条款。

## Failure recovery

- 单个媒体抓取失败不会中止其他媒体。
- 如果不足两篇课程通过公开访问、事实和格式验证，当天会发布 `delayed` 状态，不会用旧闻
  冒充当天课程。
- 可在 GitHub Actions 手动重跑生成工作流；填写日期时必须是当前斯德哥尔摩日期。
- 如果任务在写入过程中中断，重新运行会从发布日志恢复，并且只有索引与课程文件一致时才
  会公开。
- 在 GitHub Actions 日志中查看媒体健康状态；日志刻意不输出新闻全文、模型原文回复或
  API 密钥。

## Cost control

- GitHub Pages：公开仓库可免费部署；若要保持仓库私有，请先确认你的 GitHub 套餐。
- OpenAI API：按实际模型和 token 用量计费，是日常自动更新的主要可变成本。
- 建议从较小的预付余额或约 5 美元的月度预算提醒开始，并在 OpenAI 平台查看实际用量。
- 流程每天最多发布三篇，重复判断会批量处理，相同内容会走缓存，格式修复最多重试一次。
- 没有可用的公开文章时会发布延迟状态，不会为了凑满篇数增加无效模型调用。
