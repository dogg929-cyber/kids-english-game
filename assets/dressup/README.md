# Dress Up — 画像素材配置ガイド

Dress Up（`dressup.js`）は、このフォルダに透明PNG/WebPの画像を
置くと自動的に使うように設計されています。**画像が無いカテゴリーでも
今のゲームは正常に動作します**（プレビューは`assets/princess.webp`のまま、
選択はプレビュー下の絵文字バッジだけで示されます）。

## 現在の状況

- **HAIR（髪型）：実画像を導入済み**
  `hair/long.webp` / `hair/ponytail.webp` / `hair/braids.webp`
  （いずれもPurple Dress + その髪型の全身portrait）。加えて、3択カード用に
  頭〜髪型部分だけを切り出した `hair/long_thumb.webp` / `ponytail_thumb.webp`
  / `braids_thumb.webp` があり、選択肢カードは色スウォッチではなく実写の
  頭部サムネイルで表示される（文字が読めなくても写真で選べる）。
- **DRESS（ドレス）：実画像を導入済み**
  `dresses/pink.webp` / `dresses/blue.webp` / `dresses/yellow.webp`
  （いずれもLong Hair + そのドレス色の全身portrait）。
  正解タップの瞬間、Princess Previewがこの画像に「変身」する（fade+scale、
  横スライドなし）。以後、発音練習・Great job・次のカテゴリー・完成画面まで
  同じ画像を維持し、PLAY AGAINでベース画像に戻る。
- **CROWN / SHOES：まだ仮素材（色スウォッチ＋絵文字カード）のまま**
  実画像が用意でき次第、下記の「`dressup.js` 側の対応」と同じ手順
  （`assetPath`を設定し`hasAsset: true`を追加）で同じ変身演出がそのまま使える。

### ⚠️ HAIR × DRESS の組み合わせに関する既知の制約

HAIRとDRESSの画像は、どちらも**「もう片方のカテゴリー込みの全身portrait」**
であり、髪だけ／ドレスだけを切り抜いた透明レイヤー素材ではありません
（HAIR画像は全部Purple Dress固定、DRESS画像は全部Long Hair固定）。

そのため今の実装は「最後にhasAssetな選択をしたカテゴリーの画像で
Princess Preview全体を丸ごと上書きする」方式です。ゲームの出題順は固定で
HAIR→CROWN→DRESS→SHOESなので、実際の見え方は：

1. HAIRを選ぶ → Previewがその髪型のportrait（Purple Dress込み）に変身
2. CROWNは仮素材なので見た目は変わらない
3. **DRESSを選ぶ → Previewがそのドレス色のportrait（Long Hair込み）に
   変身し、直前まで表示されていた選択した髪型は見た目上消えて
   Dress画像に焼き込まれたLong Hairに戻る**
4. SHOESは仮素材なので見た目は変わらない（Dress画像のまま）
5. 完成画面も最後に変身したDress画像のまま

**選んだHairのid自体は`dressup.selections.hair`にきちんと記録され続けて
おり**（Look Badgeの「HAIR達成」表示やスコアには一切影響しません）、
失われるのは「同時に見た目へ反映すること」だけです。

これを解消するには、HAIR/CROWN/DRESS/SHOESそれぞれを**同一のbase
portrait・同一座標**の上に重ねられる、**髪だけ／ドレスだけを切り抜いた
透明レイヤー素材**（下記「想定する構造」）が必要です。現在の画像から
そのような高品質な透明レイヤーを機械的に生成するのは、顔・耳・首まわりの
境界が不自然になるリスクが高く実施していません（無理に合成して
品質を落とすよりも、現状の「全身差し替え・後勝ち」方式を暫定仕様として
採用しています）。

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

`DRESSUP_ITEMS`の各アイテムに`thumbPath`（3択カードに表示する小さな
サムネイル画像）を設定すると、`renderDressUpChoices`が自動的に色スウォッチ
の代わりにその画像を使う（現在HAIRの3項目に設定済み。`hair/long_thumb.webp`
など、頭〜髪型部分だけを切り出した専用サムネイル）。

DRESSはあえて`thumbPath`を設定していない：3色の違いはドレス（スカート）
の色で決まるため、頭部だけを切り出すサムネイルでは3色の違いが見えなく
なってしまう。DRESSに実写サムネイルを導入する場合は、頭部ではなく
スカート部分を含む縦長クロップ（またはフルボディの小さな縮小表示）を
別途生成し、`thumbPath`に設定すること。

CROWN/SHOESに実画像を追加する場合も、同様に選択肢の違いが伝わる
クロップ範囲（CROWNなら頭部、SHOESなら足元）でサムネイルを別途生成し、
`thumbPath`を設定すれば自動的に写真カードへ切り替わる。
