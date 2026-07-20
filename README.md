# General-PETS

General-PETS 是一个适用于 Windows 平台的通用桌面宠物引擎。该项目旨在将宠物引擎核心逻辑与宠物的美术资源分离，使得只需替换对应的配置文件和序列帧动画，即可快速定制出全新的桌面宠物，而无需修改和重新编译任何核心程序代码。

> **GitHub:** [https://github.com/lockezhan/General-PETS.git](https://github.com/lockezhan/General-PETS.git)

## 项目介绍

本引擎基于 Tauri 2 + Vite + TypeScript + Rust 进行开发。它提供了一个无边框、透明、始终置顶的桌面窗口，并通过基础的状态机驱动桌宠做出反应。

## 设计原则

1. **桌宠是陪伴对象**，不是需要维护的虚拟宠物。
2. **零成长数值负担**：不设置好感度、等级、货币、任务或签到机制。
3. **零惩罚反馈**：不因用户长期不互动而给予惩罚或负面反馈。
4. **即时即用**：所有互动均为即时反馈，随用随走，不形成任何使用负担。
5. **允许被忽略**：桌宠应允许被完全忽略，并在用户忙碌时保持安静（或仅限原地自主切换动作/神态）。
6. **体验优先**：功能优先服务于角色表现力、自然互动和使用舒适度。
7. **拒绝奖励循环**：不通过奖励循环或数值成长提高用户停留时间。

## 开发环境要求

为了在本地进行开发或构建，您需要准备以下环境：
- Windows 10 或 11
- [Node.js (LTS)](https://nodejs.org/zh-cn)
- [Rust 工具链](https://www.rust-lang.org/zh-CN/tools/install) (包括 `rustc` 和 `cargo`)
- Visual Studio C++ Build Tools (安装 Rust 时通常会提示或自带)
- WebView2 Runtime (Windows 10/11 通常已自带)

## 安装依赖

在项目根目录下打开终端 (如 PowerShell)，运行以下命令安装前端依赖：

```powershell
npm install
```

## 开发模式运行方法

要启动包含热重载的开发环境，请运行：

```powershell
npm run tauri dev
```
这将启动一个本地服务器，同时开启 Tauri 窗口。在开发模式下，由于框架的安全性策略，右键菜单等功能可能会被保留以便调试。

## Windows 打包方法

若要打包成可独立分发的 Windows 安装程序 (`.exe`)，请运行：

```powershell
npm run tauri build
```
打包成功后，安装程序将会生成在 `src-tauri\target\release\bundle\nsis\` 目录下。

## 项目目录说明

```text
General-PETS/
├─ public/                 # 静态资源，包括角色包
│  └─ characters/          # 所有的角色包都存放在这里
│     └─ default/          # 默认测试角色
├─ src/                    # 前端核心代码
│  ├─ pet/                 # 桌宠控制器、状态机、加载器、动画播放器逻辑
│  ├─ styles/              # 桌宠相关样式 (pet.css 等)
│  └─ main.ts              # 前端入口文件
├─ src-tauri/              # Rust 后端代码
│  ├─ src/main.rs          # 窗口控制、系统托盘、系统事件处理
│  └─ tauri.conf.json      # Tauri 核心配置
├─ package.json            # Node.js 依赖及脚本配置
└─ README.md               # 项目说明文档
```

## 角色资源包格式

角色资源全部位于 `public/characters/<角色ID>/` 下，核心配置文件为 `character.json`，格式如下：

```json
{
  "id": "default",
  "name": "Default Pet",
  "version": 1,
  "window": { "width": 260, "height": 300 },
  "render": { "width": 220, "height": 260, "anchorX": 0.5, "anchorY": 1 },
  "animations": {
    "idle": { "path": "animations/idle", "frames": 4, "fps": 4, "loop": true },
    "happy": { "path": "animations/happy", "frames": 4, "fps": 8, "loop": false, "fallback": "idle" },
    "angry": { "path": "animations/angry", "frames": 4, "fps": 8, "loop": false, "fallback": "idle" },
    "dragged": { "path": "animations/dragged", "frames": 1, "fps": 1, "loop": true }
  }
}
```

## 如何添加新角色

要添加新角色，请严格遵循以下步骤：
1. **复制模板**：复制 `public/characters/default` 整个文件夹。
2. **重命名文件夹**：将复制出来的文件夹重命名为您想要的新角色 ID（例如 `my-pet`）。
3. **修改配置**：打开该文件夹内的 `character.json`，修改 `id` 和 `name` 字段，使其与文件夹名称一致。
4. **替换资源**：替换 `animations/` 下各状态（如 `idle`, `happy`, `angry`, `dragged`）的序列帧图片（通常为 `.svg` 或 `.png`）。
5. **一致性检查**：保持同一状态下所有帧的尺寸和角色的脚底锚点完全一致，以免播放时发生抖动。
6. **启动验证**：在程序配置中将启动 ID 修改为该角色 ID，并启动程序验证动画是否流畅、过渡是否自然。

## 当前已实现功能

- **无边框透明窗口**：实现了桌宠的核心表现形式，不可通过边框缩放，始终置顶。
- **角色资源解耦**：实现了基于 `character.json` 动态加载序列帧的架构。
- **基础动画系统**：支持按指定 FPS 播放循环或单次动画，支持状态结束后自动回退（如 happy 播放完毕退回 idle）。
- **基础鼠标互动**：
  - **单击**：触发 happy 动画并显示随机本地对话气泡。
  - **连击 (短时间 >4次)**：触发 angry 动画并显示对话气泡。
  - **拖拽**：鼠标按住移动超过阈值可实现原生窗口拖拽，期间保持 dragged 动画。
- **随机行为**：在闲置时间（30-90秒）未受打扰时，有概率触发随机行为。
- **系统托盘**：实现了右下角系统托盘菜单，支持“显示”、“隐藏”、“重置位置”和“彻底退出”。窗口点击关闭时默认隐藏至托盘。

## 当前未实现功能

- 网络请求与云端同步
- ChatGPT 等智能 AI 对话接口
- 语音唤醒、识别与合成
- 物理引擎（如自由落体、屏幕边缘碰撞、重力效果）
- 自动游走与桌面窗口互动
- 换装系统与商店系统
- Live2D / Spine 等复杂的骨骼动画支持

## 常见问题

**Q: 为什么我在开发环境下看到了浏览器的右键菜单或者能够选中文字？**
A: 本项目在 `pet.css` 中配置了全局防止拖拽和选中的代码。但在开发模式下可能会有开发者工具相关的保留行为。打包后的 `.exe` 行为会严格遵循无边框全沉浸式体验。

**Q: 点击关闭按钮后程序为什么还在后台？**
A: 按照设计，直接关闭窗口仅将桌宠隐藏至托盘（类似常见后台工具软件），防止误触导致退出。若需彻底退出，请右击系统托盘图标，点击“退出”。
