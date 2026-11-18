# 芯火相传 · 学习笔记资料库

学生端按课程学期、届次或知识点查找资料，打开课程后即可预览或下载 PDF。项目初始收录 12 门课程。当前目录等待审核通过的资料。

## 管理端

Windows 双击“打开管理端.cmd”，在浏览器登录框填写事先设置的管理账号及密码。首次在另一台电脑启动时，可按提示设置该机的账号和密码。管理端仅在本机运行，凭据保存在本机用户数据目录。学生端静态网站无需登录，发布的文件只包含 `docs`。

1. 选择届次和课程，选择一份或多份 PDF。系统使用原文件名作为标题。
2. 可勾选“标记为优秀资料”，按需要填写署名和知识点。
3. 点“上传并更新目录”。本地学生端立即更新。启用 GitHub 同步后，保存会自动提交并启动 Pages 发布。
4. 下一届从“管理届次与课程”依次添加届次、缺少的学期和新课程。既有资料继续显示在原届次下。

也可以直接双击 `docs/index.html` 预览学生端。运行管理端需要 Node.js。多位管理员应先同步仓库到最新版本，再各自操作。GitHub 发布状态在该仓库 Actions 中查看。

## 首次配置 GitHub Pages

独立创建空仓库，仅将本项目内容放入其中。隐含目录 `.github/workflows` 必须保留。第一次推送到 `main` 后，在 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**，然后到 **Actions → 发布学习资料站** 手动运行一次。部署结果会给出学生端网址。

管理端自动同步需要站点目录本身是独立的 Git 仓库，当前分支为 `main`，`origin` 指向已授权写入的 GitHub HTTPS 仓库。在该站点仓库设置 `git config --local xinhuo.autoPublish true` 后重新打开管理端。GitHub 登录用系统的 Git 凭据管理，管理端密码不会上传。每次更新会先保存到本机，GitHub 同步失败时可重试。

若直接从 GitHub 网页上传，已存在的课程可在 `docs/files/<届次编号>/<课程编号>/general/` 上传普通资料，或在 `featured/` 上传优秀资料。提交后工作流扫描目录并自动发布。新届次和新课优先在管理端创建。

公开仓库中的站点与 PDF 可被任何访问者查看。把经审核允许公开的 PDF 放到站点。若学院限定校内访问，需要换用支持校内访问控制的托管。

参考 [GitHub Pages 发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [GitHub 网页上传文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)。
