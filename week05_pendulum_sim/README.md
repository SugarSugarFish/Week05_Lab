# 第 5 周实验 · 单摆仿真（Pendulum Simulation）

## 一、实验者信息

| 项目 | 内容 |
|---|---|
| 姓名 | 杨明辉 |
| 学号 | 5702126059 |
| 实验周期 | 第 5 周 |
| 模块名 | `week05_pendulum_sim` |

## 二、无菌工作区就绪状态

**状态：已就绪（ISOLATED / STERILE — READY）**

- [x] 本目录为第 5 周**专属独立子模块**，与第 1–4 周代码、与仓库其他模块**物理隔离**；
- [x] 目录内**不存在**任何跨周引用、共享状态、复制粘贴的旧代码或历史残留文件；
- [x] 本目录**不依赖**父目录以外的任何文件；
- [x] 实验所需依赖、数据、脚本一律在本目录内部自持（self-contained）。

> 约束：后续所有第 5 周的源码、数据、笔记、图表，只允许落在本目录内。
> 任何需要与其它周次共享的内容，必须先在本目录内独立实现，不得直接引用外部路径。

## 三、目录结构

```text
week05_pendulum_sim/
|-- README.md            # 本文件：实验说明与工作区状态
|-- commit_baseline.bat  # Git 基线锁定脚本（Windows / cmd，双击即可）
|-- build.sh             # 同上，Bash 版本（git bash 下使用）
|-- src/                 # 仿真源码
|-- data/                # 原始数据与采集记录
|-- docs/                # 实验笔记、分析文档
`-- results/             # 输出结果、图表、结论
```

> 目录现在还只是空骨架（各目录内仅有 `.gitkeep` 占位），等待填入单摆仿真的实现。

## 四、Git 基线（已锁定）

本子模块的初始状态已提交：仓库根 `F:\Week5` 的 `main` 分支上目前只有这一个
root commit，它就是本实验的基线。

| 项目 | 值 |
|---|---|
| 基线引用 | `HEAD`（当前唯一提交，root commit） |
| 提交信息 | `feat(week05): init pendulum experiment workspace` |
| 作者 | 杨明辉 `<5702126059@course.local>` |
| 分支 | `main` |
| 内容 | 9 个文件（本目录 8 个 + 仓库根的工作区说明） |

查看基线的确切哈希与校验命令（在仓库根目录 `F:\Week5` 执行）：

```bash
git log --oneline -1          # 基线提交（本仓库唯一的提交）
git rev-parse HEAD            # 完整哈希
git rev-parse 'HEAD^{tree}'   # tree 哈希
git status                    # nothing to commit, working tree clean
git fsck --full               # 无输出 = 对象库完整
```

若日后需要重新建立基线（例如误删了 `.git`），执行：

```bash
git init -b main
git add .
git commit -m "feat(week05): init pendulum experiment workspace"
```

---

*本 README 由第 5 周实验工作区初始化时写入，用于声明子模块的独立性与无菌就绪状态。*
