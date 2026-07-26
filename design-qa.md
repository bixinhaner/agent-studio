# Portal 用户工作区视觉验收

## 设计基准

- 桌面文件夹主页：`docs/assets/portal-user-workspace-design/01-desktop-folder-home.png`
- 桌面任务会话：`docs/assets/portal-user-workspace-design/02-desktop-task-conversation.png`
- 桌面文件预览与版本：`docs/assets/portal-user-workspace-design/03-desktop-file-preview-versions.png`
- 移动端工作区导航：`docs/assets/portal-user-workspace-design/04-mobile-workspace-navigation.png`

## 对比结果

同一视口下把 ImageGen 基准图与真实实现截图并排检查，完成了三轮桌面布局和四轮移动端导航逼近。最终实现保留现有 Agent Studio 品牌、assistant-ui 会话能力和生产信息密度，同时复刻了以下核心结构：

- 左栏只承载智能视图、文件夹和当前文件夹任务，不平铺大量文件。
- 中栏在文件夹列表与现有聊天之间切换，任务位置通过面包屑持续可见。
- 右栏承载任务文件、文件内容和版本历史；1024–1279 像素时改为覆盖抽屉，避免压窄主任务区。
- 375/393/768 像素使用全屏工作区抽屉，保留搜索、任务和回收站的直接入口。

最终检查未发现内容截断、水平滚动、不可达主操作或 P0/P1/P2 视觉问题。桌面任务截图中的消息内容随真实会话数据变化，不作为静态像素差异。

## 响应式验证

| 视口 | 结果 |
| --- | --- |
| 375 × 852 | 单栏内容与全屏工作区抽屉，无水平溢出 |
| 393 × 852 | 与移动端 ImageGen 基准并排复核通过 |
| 768 × 900 | 移动端导航与内容区无水平溢出 |
| 1024 × 900 | 左栏 + 主内容，右侧文件面板使用覆盖抽屉 |
| 1440 × 900 | 左栏 + 主内容 + 右侧文件面板三栏布局 |

final result: passed
