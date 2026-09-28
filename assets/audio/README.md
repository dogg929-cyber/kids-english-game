# Princess English — 音源ファイル配置ガイド

このフォルダに以下のファイルを置くと、Audio System（`audio.js`）が自動で
使用します。著作権・ライセンスが確認できる音源のみを配置してください。
**ファイルが無くてもゲームは正常に遊べます**（無音になるだけで、進行は
止まりません。`correct`だけは音源が無い場合、既存の合成チャイム音に自動で
フォールバックします）。

| ファイル | 用途 | 目安の長さ・音量 |
| --- | --- | --- |
| `princess-theme.mp3` | BGM（ループ再生） | 30〜60秒でループ、初期音量15〜20% |
| `play.mp3` | PLAYボタンを押した時 | 短い「キラリン✨」のようなmagical chime |
| `correct.mp3` | 体の部位を正解タップした時 | 柔らかい「ポン♪」+ sparkle程度 |
| `wrong.mp3` | 間違った場所をタップした時 | 非常に軽い「ぽっ」。ブザー・低い失敗音は禁止 |
| `sparkle.mp3` | 発音成功（MINI DANCE）時 | 短いmagic sparkle |
| `clear.mp3` | 10問クリア時 | 1〜2秒程度のmagical fanfare |

BGMの方向性：magical princess / fairy tale。gentle, happy, warm, playful。
オルゴール + 柔らかいベル + 軽いピアノ + キラキラした魔法感。歌・人声なし。
激しいドラム・強い低音なし。
