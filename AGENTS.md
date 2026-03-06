# Project Agent Instructions

- 如果实现功能，优先参考 `assistant-ui`。
- If temporary verification and test scripts or code are generated during the task, please create them in the project's temp directory. If the directory does not exist, create it.Other temporary files or code that do not affect business operations during the task should also be placed in the temp directory.
- 前端显示时区都要跟随用户本地时区。
- 当用户要求执行 Git 提交并推送 GitHub 时，必须严格按以下流程串行执行（禁止并行执行任何会修改 Git 状态的命令，如 add/commit/amend/notes/push）：先确认提交范围（全部或部分）并 `git add`，再提交；提交信息和 note 若为多行必须使用真实换行，禁止在文本中写字面量 `\n`；若有 note，提交后执行 `git notes add`；随后必须用 `git show -s --format=%B HEAD` 与 `git notes show HEAD` 自检格式；最后先推送分支再推送 `refs/notes/commits`，如因 amend 导致提交哈希变化则使用 `--force-with-lease`；完成后向用户明确反馈提交哈希与推送结果。
