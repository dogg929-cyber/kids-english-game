# Dress Up — 画像素材配置ガイド

Dress Up（`dressup.js`）は、このフォルダに透明PNG/WebPの画像を
置くと自動的に使うように設計されています。**画像が無いカテゴリーでも
今のゲームは正常に動作します**（プレビューは`assets/princess.webp`のまま、
選択はプレビュー下の絵文字バッジだけで示されます）。

## 現在の状況

- **DRESS（ドレス）：実画像を導入済み**
  `dresses/pink.webp` / `dresses/blue.webp` / `dresses/yellow.webp`。
  正解タップの瞬間、Princess Previewがこの画像に「変身」する（fade+scale、
  横スライドなし）。以後、発音練習・Great job・SHOESステージ・完成画面まで
  同じ画像を維持し、PLAY AGAINでベース画像に戻る。
- **HAIR / CROWN / SHOES：まだ仮素材（色スウォッチ＋絵文字カード）のまま**
  実画像が用意でき次第、下記の「`dressup.js` 側の対応」と同じ手順
  （`assetPath`を設定し`hasAsset: true`を追加）で同じ変身演出がそのまま使える。

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

各アイテムの `DRESSUP_ITEMS` 定義には `assetPath` フィールドが用意されて
います。画像を置いて使えるようにする場合、そのアイテムに
`hasAsset: true` を追加してください（`dresses/pink|blue|yellow` は既に
設定済み）。`hasAsset: true` のアイテムが正解として選ばれると、
Princess Previewが自動的にその画像へフェード＋scaleで「変身」し、
発音練習・Great job・次のカテゴリー・完成画面まで維持されます
（`dressup.activePortraitSrc` で状態管理。PLAY AGAINでリセット）。

**注意：現在の実装は「全身差し替え」方式です。** 今回用意した
`dresses/pink|blue|yellow.webp` はドレスだけを切り抜いた透明レイヤーでは
なく、プリンセス全身（頭〜足）を1枚の画像として書き出したものです。
そのため今のコードは「プレビュー画像そのものを丸ごと差し替える」方式で
実装されています。将来、髪型・かんむり・くつも同様に全身を書き出した
素材で揃える場合は、同じ`hasAsset:true`方式がそのまま使えます（ただし
`hair`と`dress`のように異なるカテゴリーを同時に反映させることはできず、
最後に選ばれた1カテゴリーの全身画像で丸ごと上書きされる点に注意）。
下記の「想定する構造（レイヤー合成）」のような、髪型/かんむり/ドレス/
くつを個別の透明レイヤーとして重ね合わせる本格的な合成に切り替える
場合は、`renderDressUpPreview`/`swapDressUpPreviewImage`まわりを
「複数`<img>`を重ねてそれぞれのsrcを更新する」実装に書き換える必要が
あります。

## 選択肢カードの見た目

現在、3択カードは画像の代わりに「色スウォッチ＋絵文字＋英単語」の
プレースホルダーカードです。将来、各アイテムのサムネイル画像
（例: `assets/dressup/dresses/blue.webp` を小さく表示）に差し替える場合も
`dressup.js` の `renderDressUpChoices` 内、カード生成部分だけを直せば
反映されます。
