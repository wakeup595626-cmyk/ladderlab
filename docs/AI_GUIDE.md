# LadderLab 工程文件生成指南（给 AI 看）

这份文档是给 AI 助手（Codex、Claude、Cursor 等）读的说明书。目标只有一个：
把一段中文的课程设计题目，变成一份能直接导入 LadderLab 的 `.ladderlab.json`。

## 三条铁律

1. **只输出 JSON，不输出解释。** 需要解释的部分放在 JSON 之外的对话里。
2. **变量必须先声明再使用。** 触点、线圈里出现的每个名字，都必须在 `tags` 里有一条定义，
   或者是一个已声明的定时器/计数器实例的 `.Q` 位（如 `T1.Q`）。
3. **每个程序段只有一个输出。** 一个 `rung` = 一条串联主干 = 一个 `output`。
   需要多个输出就拆成多个程序段。

## 文件结构

```jsonc
{
  "schema": 1,              // 固定写 1
  "name": "八路流水灯",      // 工程名，可以中文
  "profile": "v21",         // "v14" 或 "v21"；v14 不支持 TONR
  "tags": [ ... ],          // 变量表
  "rungs": [ ... ]          // 程序段
}
```

## 变量（tags）

```jsonc
{
  "id": "t-start",          // 全文件唯一，自己起名，建议 t-xxx
  "name": "Start",          // 梯形图上显示的名字，只能字母/数字/下划线，不能数字开头
  "address": "%I0.0",       // 地址，见下方约定
  "kind": "BOOL",           // "BOOL" 或 "INT"
  "initial": false,         // BOOL 必须是 true/false；INT 必须是数字
  "comment": "启动开关",     // 中文注释，会显示在变量表里
  "bitOf": "LampByte"       // 可选：作为某个 INT 字节变量的一位，写那个变量的 name
}
```

地址约定：

- 输入 `%I0.0` ~ `%I1.7`
- 内部存储 `%M0.0` ~ `%M99.7`
- 输出 `%Q0.0` ~ `%Q1.7`
- 字节/字 `%MB10`、`%MW10`、`%MD10`
- 位别名（`bitOf`）的地址必须和它所属的字节变量在同一个字节：
  `LampByte` 用 `%MB10`，则 `Lamp1` 用 `%M10.0`、`Lamp2` 用 `%M10.1`。

## 程序段（rungs）

```jsonc
{
  "id": "r1",               // 全文件唯一
  "label": "正转自锁与互锁",   // 这个程序段在做什么，中文一句话
  "nodes": [ ... ],          // 串联条件，从电源侧向输出侧排列
  "output": { ... }          // 唯一的输出
}
```

节点只有两种：

```jsonc
// 触点
{ "type": "contact", "id": "c1", "kind": "NO", "tag": "Start" }
{ "type": "contact", "id": "c2", "kind": "CMP", "tag": "Count", "compare": { "op": ">=", "value": 5 } }

// 并联支路（每个 branch 是一条串联链）
{
  "type": "parallel",
  "id": "p1",
  "branches": [
    [ { "type": "contact", "id": "c3", "kind": "NO", "tag": "SB_Forward" },
      { "type": "contact", "id": "c4", "kind": "NC", "tag": "KM_Reverse" } ],
    [ { "type": "contact", "id": "c5", "kind": "NO", "tag": "KM_Forward" } ]
  ]
}
```

触点 kind：

- `NO` 常开，`NC` 常闭
- `P` 上升沿，`N` 下降沿（只在跳变的那一扫描有效）
- `CMP` 比较，必须带 `compare`，可用于 BOOL 的 `==` 或 INT 的大小比较

## 输出

```jsonc
{ "id": "o1", "kind": "COIL", "tag": "KM_Forward" }
{ "id": "o2", "kind": "SET",  "tag": "Step1" }
{ "id": "o3", "kind": "RESET","tag": "Step1" }
{ "id": "o4", "kind": "TON",  "tag": "T1", "pt": 500 }
{ "id": "o5", "kind": "CTU",  "tag": "C1", "pv": 5, "resetTag": "Reset" }
{ "id": "o6", "kind": "MOVE", "tag": "LampByte", "value": 1 }
{ "id": "o7", "kind": "ROL",  "tag": "LampByte", "value": 1 }
{ "id": "o8", "kind": "PATTERN", "tag": "LampByte", "pulseTag": "Tick", "pattern": [1, 3, 7, 15] }
```

| kind | 含义 | 必需字段 |
| --- | --- | --- |
| `COIL` | 普通线圈，能流断则灭 | `tag` |
| `SET` / `RESET` | 置位 / 复位，保持 | `tag` |
| `TON` / `TOF` / `TONR` | 通电延时 / 断电延时 / 保持型 | `tag` 是**实例名**，`pt` 是毫秒 |
| `CTU` | 加计数 | `tag` 是实例名，`pv` 是预设值 |
| `MOVE` | 整数传送 | `tag` 目标、`value` 或 `sourceTag` |
| `ADD` / `SUB` | 整数加减 | 同上 |
| `SHL` / `ROL` | 左移 / 循环左移 | `tag` 目标、`value` 移几位 |
| `PATTERN` | 教学用灯字序列 | `tag` 目标字节、`pulseTag` 推进脉冲、`pattern` 灯字数组 |

定时器/计数器的实例名（如 `T1`、`C1`）不写进 `tags`，但**不能和任何变量重名**。
读取它的状态用触点 `{ "kind": "NO", "tag": "T1.Q" }`。

## 编译器的硬性限制

写之前先记住这些，能省掉一半返工：

- `pt` 必须是 1~32767 的整数（毫秒）。超过 32 秒请级联两个定时器或用计数器。
- `pv` 必须是 1~32767 的整数。
- 同一个变量不能在两个程序段里被同一类输出连续驱动（双线圈）。需要交替驱动时用 `SET`/`RESET`。
- 变量名不能重复，地址不能重叠。
- 程序段上限 1000、节点上限 5000、变量上限 1000。

## 推荐的生成步骤

1. 先读题目，输出一张 I/O 表给人看：输入几个、输出几个、每个是什么意思。
2. 判断它是不是内置实验之一（抢答器、定时计数、交通灯、三层电梯、音乐喷泉、装配流水线）。
   是的话优先复用 `src/engine/courseLabs.ts` 里的现成实现，不要重写。
3. 不是的话，先写状态转换表（几个状态、转移条件、每个状态的输出），再转成程序段。
4. 每个程序段给一句中文 `label`，让人能对上题目里的动作。
5. 输出完整 JSON，保存成 `.ladderlab.json`，让用户拖进网站或粘贴导入。
6. 如果导入报错，把报错原文贴回对话，按报错逐条修，不要整份重写。

## 参考样例

`examples/` 下有两个可以直接导入的完整工程：

- `motor-forward-reverse.ladderlab.json`：电机正反转，自锁加互锁
- `running-light.ladderlab.json`：八路流水灯，定时器节拍加循环移位

不确定怎么写的时候，照着这两个的骨架改，比从零开始稳。

## 给用户一条链接（推荐交付方式）

生成并通过 `npm test` 之后，用仓库里的脚本把整份工程压进链接：

```bash
node scripts/share-link.mjs examples/我的工程.ladderlab.json
```

它会打印一条 `https://wakeup595626-cmyk.github.io/ladderlab/#p=1.…` 的地址。
整份工程就在 `#` 后面（压缩过），不经过任何服务器。用户点开后页面会先问一句
“导入分享的工程「…」？”，点“导入”才会替换当前内容，点“先不导入”什么都不会变。

注意事项：

- 用户自己也能生成链接：网页右上角「导出 → 复制分享链接」。所以你不方便跑脚本时，
  可以让他先把工程导进网页，再自己复制一条链接转发。
- 链接超过 12000 字符时，微信、QQ 可能发不出去，改用文件导入。
- 如果你根本跑不了 `node`（只在网页里对话、没有文件系统），就跳过脚本，
  把完整 JSON 放进代码块交给用户：他点网页顶部“导入”，展开
  “没有文件？直接粘贴工程 JSON”，粘贴后点“导入并打开”，效果一样。
- 片段里的内容是压缩数据，不要手工改动其中任何字符，改一个字符就打不开。
- 自测时可以加 `--site http://127.0.0.1:5173/` 指向本地开发服务器。
- `npm run qa:share` 会用真实浏览器验证弹窗、取消、导入、坏链接四种情况。

## 这个项目不能做什么

- 不生成 TIA Portal 的 `.ap21` 工程，不生成 SCL / SFC / FBD / HMI。
- 不连接真实 PLC，不能下载程序。
- 生成的图可以用在课设报告里，但不能当成博途的工程文件提交。
