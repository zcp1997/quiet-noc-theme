# Quiet NOC

[monitor](https://github.com/monitor-probe/monitor) 的第三方主题。Quiet NOC 采用安静、低干扰的视觉风格，优先突出异常状态，并提供四列桌面布局、对比列表、详细图表和实时指标更新。

![Quiet NOC 主题预览](preview.png)

## 安装

从 [Releases](https://github.com/zcp1997/quiet-noc-theme/releases) 下载 `theme.tar.gz`，解压到 monitor hub 的主题目录。目录名必须与 `theme.json` 中的 `short` 一致：

```text
<themes-dir>/quiet-noc/
├── theme.json
├── preview.png
└── dist/
    ├── index.html
    └── assets/
```

在现有 hub 启动参数中通过 `--themes` 指定主题目录，然后在后台的「主题」页面切换到 Quiet NOC：

```bash
monitor-hub --listen 127.0.0.1:9911 --db /tmp/monitor.db \
  --site http://127.0.0.1:9911 --themes <themes-dir>
```

也可以直接克隆本仓库，将仓库目录复制或链接为 `<themes-dir>/quiet-noc/`。本仓库已经包含构建后的 `dist/`，安装时不需要额外的前端构建步骤。

## 主题包

可安装主题由以下内容组成：

| 路径 | 用途 |
|---|---|
| `theme.json` | 主题名称、唯一短名、版本、作者和源码地址 |
| `preview.png` | 后台主题列表中的预览图 |
| `dist/index.html` | 主题入口页面 |
| `dist/assets/` | 样式表和 JavaScript 资源 |

主题使用 monitor hub 提供的同源接口：

| 接口 | 用途 |
|---|---|
| `GET /api/me` | 站点与登录状态 |
| `GET /api/nodes` | 节点列表和实时指标 |
| `GET /api/nodes/{id}/metrics` | 历史指标与延迟记录 |
| `GET /api/ws` | 节点快照 WebSocket 推送 |

本主题的详情页路径为 `/node/{id}`，从列表进入详情页时使用 `pushState`，不会立即向服务器请求该路径。monitor hub 本身支持 SPA 回落；如果 hub 前面的反向代理或 WAF 使用按路径白名单，还需要放行 `/node/` 前缀，否则会出现“列表点进去正常、刷新详情页被拦”的现象。

## 自动打包

GitHub Actions 会在以下情况生成 `theme.tar.gz` 和 `theme.tar.gz.sha256`：

- 提交推送到 `main` 分支时，可在对应 Actions 运行的 Artifacts 中下载；
- 推送 `v*` 标签时，除保存 Actions Artifact 外，还会自动创建 GitHub Release 并上传两个文件；
- 也可以在 Actions 页面手动运行工作流。

发布新版本前，请先更新 `theme.json` 中的 `version`，再创建对应标签，例如：

```bash
git tag v1.0.0
git push origin v1.0.0
```

如需在本地生成相同的安装包，可运行：

```bash
tar czf theme.tar.gz dist theme.json preview.png
```
