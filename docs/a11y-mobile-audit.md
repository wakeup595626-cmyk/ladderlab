# LadderLab 可访问性与移动端审计

审计日期：2026-10-29  
审计对象：`feat/sfc-per-lab` 工作树  
浏览器：Microsoft Edge（Playwright `channel: msedge`，headless）  
移动视口：390 × 844，触摸与移动端 UA 模拟；桌面视口：1280 × 900

## 结论

本轮修复了会影响键盘、读屏或触摸用户的问题，并新增可重复运行的自动化审计。最终移动端与桌面端 axe-core 检查均为 0 条违规；自动化检查为 13 项通过、0 项失败、0 项提示，触控目标全部达到 44 × 44 px。此结果来自本地生产构建预览的浏览器自动化，不等同于真机读屏或真实触摸设备验收。

## 已修问题

| 问题 | 修改位置 | 处理 | 实测结果 |
| --- | --- | --- | --- |
| 手机端品牌区被 `display:none`，页面唯一 `h1` 从无障碍树消失 | `src/Shell.css` 的 `.wb-brand-name`、宽 480/520 px 下的 `.wb-shell .wb-brand` | 不占视觉布局，但以 1 px 裁剪方式保留标题 | 390 px 下 axe 不再报告页面缺少一级标题 |
| “减少动态效果”只停掉 animation，过渡仍持续 140–240 ms | `src/index.css` 的 `prefers-reduced-motion: reduce` 区块 | 同时把 `transition-duration` 压到 0.01 ms、延迟归零 | 修复前检出 16 组仍在运行的过渡，最长 0.22 s；修复后所有元素 `transition-duration ≤ 50 ms` |
| 窄屏样式把工程名输入框和教练条关闭按钮压回 40 px | `src/Shell.css` 文件末尾的 `@media (pointer: coarse)` | 在层叠顺序最后把两处恢复为 44 px | 390 px 触摸视口不再报告这两处尺寸不足 |
| 支持作者浮标不在 landmark 内，触发 axe `region` 违规 | `src/components/SupportBadge.tsx` | 根元素由 `div` 改为带 `aria-label="支持作者"` 的 `aside` | 移动端和桌面端 axe 均为 0 条违规 |
| 打赏浮标按钮只有 60 × 30 px | `src/components/SupportBadge.css` | 视觉条带保持原样，用负外边距把实际点击区向上扩到 44 px | 390 px 触屏审计通过 |
| 配色按钮只有 40 × 36 px | `src/Shell.css` 文件末尾的粗指针规则 | 视觉尺寸不变，最小点击区提升到 44 × 44 px | 390 px 触屏审计通过 |
| 程序段操作菜单条目高度差 1 px | `src/Shell.css` 的粗指针规则 | 菜单按钮最小高度统一为 44 px | 菜单打开后审计通过 |

另修正了更新提示条的两个操作按钮：移除固定 30 px 内联高度，改由 `src/components/UpdateBanner.css` 控制；桌面保持 30 px，粗指针设备提升到 44 px，并增加左右内边距。相关按钮位于 `src/components/UpdateBanner.tsx`。

## 复核说明

上述尺寸采用 CSS 点击区而非仅视觉外框，鼠标设备的外观不变。打赏浮标仍可拖动，位置记忆与拖拽边界未改动。

## 自动化检查

脚本：`scripts/qa-a11y.mjs`

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4211 --strictPort
node scripts/qa-a11y.mjs
```

脚本默认访问 `http://127.0.0.1:4211/`，可用 `QA_A11Y_URL` 覆盖。stdout 输出完整 JSON，stderr 输出人读摘要；有失败项时退出码为 1。检查覆盖：

- 390 px 视口横向溢出与底部固定栏安全区；
- 顶栏 Tab 顺序、键盘焦点可见性、可见按钮名称；
- 触控目标尺寸；文本对比度；移动端与桌面端 axe-core；
- 导出菜单的 Enter、方向键、End、Esc 和焦点归还；
- `prefers-reduced-motion: reduce` 下的实际过渡时长。

### 关键基线

| 指标 | 实测值 |
| --- | --- |
| 390 px 页面宽度 | `scrollWidth=390`，`clientWidth=390`，无横向溢出 |
| 顶栏可聚焦控件 | 6 个，Tab 覆盖 6 个 |
| 键盘焦点停靠点 | 7 个，全部有 `outline` 或 `box-shadow` |
| 可见按钮命名 | DOM 中 42 个，可见可交互 22 个，无名称 0 个 |
| 文字对比度 | 实测 9 组，最低 4.74:1（`span.ll-tool-label`，要求 4.5:1） |
| 底部固定栏 | `.wb-tabbar` 底边 844/844，`.status-bar` 底边 787/844，均完整落在视口内 |
| axe-core | 移动端 0 条违规，桌面端 0 条违规 |
| 导出菜单 | Enter 聚焦“工程文件（.json）”；ArrowDown 到“复制分享链接”；End 到末项；Esc 关闭并归还焦点 |

## 验证边界

- 样式与交互通过生产构建后的 Chromium 自动化验证；未在 iOS Safari、Android 真机或实体读屏软件上复测。
- 触摸目标检查使用 CSS 外框和脚本可见性判定，不模拟手指遮挡、系统缩放或浏览器工具栏造成的可视区变化。
- 对比度检查取页面实际渲染的 9 组代表文字；不是全站所有像素组合的穷举。
