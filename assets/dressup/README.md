# Dress Up — 画像素材配置ガイド

Dress Up（`dressup.js`）は、このフォルダに透明PNG/WebPのレイヤー画像を
置くと自動的に使うように設計されています。**画像が無くても今のゲームは
正常に動作します**（プレビューは`assets/princess.webp`のまま、選択は
プレビュー下の絵文字バッジだけで示されます）。

## 想定する構造（レイヤー合成）

```
base/      … 素体（顔・体・腕など、髪型/かんむり/ドレス/くつを含まない土台）
hair/      … 髪型レイヤー（long.webp / ponytail.webp / braids.webp）
crowns/    … かんむりレイヤー（gold.webp / flower.webp / purple.webp）
dresses/   … ドレスレイヤー（pink.webp / blue.webp / yellow.webp）
shoes/     … くつレイヤー（pink.webp / blue.webp / purple.webp）
```

すべて **同一canvas比率・同一座標**（`assets/princess.webp`と同じ
1024×1536 / 2:3）を前提にした透明PNG/WebPにしてください。実装側は
`position:absolute; top:0; left:0; width:100%;` で base → hair → crown →
dress → shoes の順に重ねるだけで、拡大縮小やscaleX/scaleYの調整は一切
不要になるように作られています（画像を歪ませる非対称スケールは禁止）。

## `dressup.js` 側の対応

各アイテムの `DRESSUP_ITEMS` 定義に `assetPath` フィールドがすでに
用意されています。画像を置いたら、そのアイテムの `assetPath` をコメント
アウトから有効な値に変更し、プレビュー描画ロジック（`renderDressUpPreview`
まわり）を「レイヤー重ね合わせ」に切り替えるだけで反映されます（現状は
画像が無い前提でprincess.webp表示＋バッジ表示にフォールバックしています）。

## 選択肢カードの見た目

現在、3択カードは画像の代わりに「色スウォッチ＋絵文字＋英単語」の
プレースホルダーカードです。将来、各アイテムのサムネイル画像
（例: `assets/dressup/dresses/blue.webp` を小さく表示）に差し替える場合も
`dressup.js` の `renderDressUpChoices` 内、カード生成部分だけを直せば
反映されます。
