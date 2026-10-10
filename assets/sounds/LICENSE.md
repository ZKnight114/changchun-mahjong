# 音效来源与许可

2026-10-08 按玩家试听选择接入：出牌 A1、吃 A2、碰 A3、杠 A4、胡牌 H2。

| 游戏文件 | 原素材 | 来源 |
| --- | --- | --- |
| discard-a1.wav | chip-lay-1.ogg | Kenney Casino Audio 1.1 |
| chi-a2.wav | chips-stack-1.ogg | Kenney Casino Audio 1.1 |
| peng-a3.wav | chips-collide-1.ogg | Kenney Casino Audio 1.1 |
| gang-a4.wav | chips-stack-4.ogg | Kenney Casino Audio 1.1 |
| win-h2.wav | jingles_HIT00.ogg | Kenney Music Jingles |

来源：[Casino Audio](https://kenney.nl/assets/casino-audio)、[Music Jingles](https://kenney.nl/assets/music-jingles)。作者为 Kenney Vleugels (Kenney.nl)，两组均为 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)，允许个人、教育及商业项目使用，无强制署名要求。包内原始许可另存为 `KENNEY-CASINO-LICENSE.txt` 和 `KENNEY-JINGLES-LICENSE.txt`。

为兼容手机浏览器，原 Ogg Vorbis 素材解码为 16-bit PCM WAV；保留原采样率、声道和时长，不裁剪、不重采样、不加音效、不调整响度。仅作一次 PCM 量化。游戏按音量设置播放。

这五个文件是通用桌面实物音与短乐，不是麻将实录或中文真人喊牌。其余旧 WAV 由项目的 `tools/make_sounds.py` 生成，此次保留，避免影响旧版本与已有缓存；当前仍使用原 `draw.wav` 和 `drawgame.wav`。

2026-10-10 新增 `ting.wav`：本项目原创生成的报听三音上行提示，659.25 / 830.61 / 987.77 Hz，时长 0.48 秒、44.1 kHz 单声道 16-bit PCM，不含第三方录音。通过 `node tools/make-ting-sound.cjs` 可确定性重建，仅生成这个文件，不覆盖既有素材。本提示音同样以 CC0 提供。
