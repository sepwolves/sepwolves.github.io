---
title: "从零搭建：Hexo 博客 + GitHub Actions 自动化部署全记录"
date: 2026-04-21 20:20:00
updated: 
tags:
  - Hexo
  - GitHub Actions
  - SSH
  - 教程
categories:
  - 技术探索
keywords: "Hexo, Keep Theme, GitHub Actions, SSH Config"
description: "记录将个人静态网页迁移至 Hexo 框架并实现 GitHub 自动部署的全过程。"
top_img:
comments: true
toc: true
sticky: 1
---

## 🚀 项目背景
将原本手写的静态 HTML 网站迁移至 **Hexo** 框架，并选用简洁优雅的 **Keep** 主题。同时解决多 GitHub 账号下的权限冲突问题，并实现“推送到源码即自动发布网站”的自动化流程。

## 🛠️ 执行步骤详述

### 1. 多账号 SSH 权限配置
针对同一台电脑上存在多个 GitHub 账号（`thougts`, `rubbertale`, `sepwolves`）的情况，我们采用了 **SSH Config 别名机制**：
- **生成密钥**：为 `sepwolves` 专门生成了 `id_ed25519_sepwolves` 密钥。
- **配置映射**：在 `~/.ssh/config` 中添加 `github-sepwolves` 别名，定向指向对应的私钥文件。
- **验证成功**：通过 `ssh -T git@github-sepwolves` 成功打通权限。

### 2. Hexo 环境大改造
- **旧站备份**：将原有的静态文件安全移至 `_old_site` 文件夹。
- **初始化**：在本地仓库执行 `hexo init`，搭建起核心框架。
- **主题安装**：引入 **Keep** 主题，并修复了主题文件夹中因 `.git` 子目录导致的“空壳”推送问题。
- **渲染器配置**：安装了 `pug` 和 `stylus` 渲染插件以支持主题展示。

### 3. GitHub Actions 自动化部署
为了实现“写完即发”，我们配置了 `.github/workflows/deploy.yml` 脚本：
- **触发逻辑**：每当 `master` 分支收到推送，GitHub 服务器会自动启动。
- **自动编译**：服务器自动执行 `npm install` 和 `hexo generate`。
- **Pages 部署**：编译后的静态产物自动分发至 GitHub Pages，无需本地手动生成。

### 4. 细节微调与兼容性修复
- **绕过 Jekyll**：添加了 `.nojekyll` 文件，防止 GitHub 屏蔽 Hexo 生成的资源文件夹（如下划线开头的 `_css`）。
- **Obsidian 适配**：优化了 `scaffolds/post.md` 模板，使用双引号包裹 `title` 和 `date` 占位符，解决了 Obsidian 属性面板显示 `null` 的语法兼容问题。
- **Git 忽略**：在 `.gitignore` 中排除了 `.obsidian/` 文件夹，保护本地笔记偏好设置不被公开。

## 📝 写作工作流
1. **新建文章**：在本地执行 `npx hexo new "文章标题"`。
2. **内容创作**：在 Obsidian 中打开 `source/_posts/` 下对应的 `.md` 文件进行书写。
3. **一键同步**：在 Obsidian 中通过 **Git: Commit and sync** 推送到 GitHub。
4. **自动上线**：等待约 1 分钟，GitHub Actions 完成构建，博客自动更新。

---

*这份报告由 Gemini CLI 协助整理并生成。*
