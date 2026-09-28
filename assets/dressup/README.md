# Dress Up — 画像素材配置ガイド

Dress Up（`dressup.js`）は、このフォルダに透明PNG/WebPの画像を
置くと自動的に使うように設計されています。**画像が無いカテゴリーでも
今のゲームは正常に動作します**（プレビューは`assets/princess.webp`のまま、
選択はプレビュー下の絵文字バッジと選択肢カードの金枠+✓だけで示されます）。

## 着せ替え状態：`dressup.equipped`（hair/crown/dress/shoesは完全に独立）

`dressup.js`内部の状態は、カテゴリーごとに完全独立した
`dressup.equipped = { hair, crown, dress, shoes }`（catId→選んだアイテム）
で管理されています。**あるカテゴリーで正解しても、他カテゴリーの
equippedは一切リセットされません**（例：`hair=ponytail` +
`crown=flower` + `dress=blue` + `shoes=purple` を同時に保持できます）。
Look Badgesと選択肢カードの金枠+✓（`.dressup-option-equipped`）は、
この状態をそのまま表示しています。

この状態設計は、現在の固定順クイズ（HAIR→CROWN→DRESS→SHOES）とは
独立して成立するため、将来「好きな順・好きな組み合わせで自由に
着せ替えられる」**FREE DRESS UPモード**を追加する場合も、この
`dressup.equipped`をそのまま流用できます（今回のリファクタはその
前提で設計されています）。

## 見た目のレイヤー合成：`dressup-layer-*`（DOM構造は用意済み）

`index.html`の`#dressup-portrait-layers`内には、
`base → dress → shoes → hair → crown` の順に重ねる透明レイヤー
スタック（`.dressup-layer`、各`position:absolute; inset:0`で完全に
同じ位置・サイズ）がすでに用意されています。アイテムに
`layerPath`（髪だけ／かんむりだけ等を切り抜いた独立透明素材のパス）と
`layerSlot`（省略時はcatIdと同じ）を設定すれば、対応する
`dressup-layer-*`にそのまま表示されます（拡大縮小やscaleX/scaleYの
個別調整は不要）。**現時点ではどのアイテムも`layerPath`を持っていません**
（下記「現在の状況」参照）。

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
であり、髪だけ／ドレスだけを切り抜いた透明レイヤー素材（`layerPath`）
ではありません（HAIR画像は全部Purple Dress固定、DRESS画像は全部
Long Hair固定）。

そのため今の実装は、`layerPath`を持たない「全身画像(`hasAsset:true`)」の
アイテムが複数equippedされている場合、`dressup.js`内の
`WHOLE_BODY_PRIORITY = ["shoes", "dress", "crown", "hair"]`という
優先順位に従って1枚だけをPrincess Preview全体に表示します（無理な合成は
しません）。現状 dress が hair より優先されるため、ゲームの出題順
HAIR→CROWN→DRESS→SHOESでは実際の見え方は：

1. HAIRを選ぶ → Previewがその髪型のportrait（Purple Dress込み）に変身
2. CROWNは仮素材なので見た目は変わらない
3. **DRESSを選ぶ → Previewがそのドレス色のportrait（Long Hair込み）に
   変身し、直前まで表示されていた選択した髪型は見た目上消えて
   Dress画像に焼き込まれたLong Hairに戻る**
4. SHOESは仮素材なので見た目は変わらない（Dress画像のまま）
5. 完成画面も最後に変身したDress画像のまま

**選んだHairのアイテム自体は`dressup.equipped.hair`にきちんと保持され
続けており**（Look Badgeの「HAIR達成」表示や選択肢カードの金枠+✓、
スコアには一切影響しません）、失われるのは「同時に見た目へ反映する
こと」だけです。

これを解消するには、HAIR/CROWN/DRESS/SHOESそれぞれを**同一のbase
portrait・同一座標**の上に重ねられる、**髪だけ／ドレスだけを切り抜いた
透明レイヤー素材**（上記「見た目のレイヤー合成」・下記「想定する構造」）
が必要です。現在の画像からそのような高品質な透明レイヤーを機械的に
生成するのは、顔・耳・首まわりの境界が不自然になるリスクが高く実施して
いません（無理に合成して品質を落とすよりも、現状の
「全身差し替え・優先順位」方式を暫定仕様として採用しています）。
アイテムに`layerPath`/`layerSlot`を設定するだけで、そのカテゴリーは
`WHOLE_BODY_PRIORITY`を経由せず独立レイヤーとして表示されるようになる
ため、これはコード変更なしで解消できます。

### ⚠️ CROWN：今回リクエストされた画像が未着で、まだ実装できていません

今回、「Gold Crown / Flower Crown / Purple Crown」の3枚を添付したとの
ご指示がありましたが、実際のメッセージには添付ファイルとしてテキスト
仕様書のみが含まれており、画像は見つかりませんでした
（このセッションのアップロード一覧を確認済み。見つかったのは既存の
Hair/Dressのトリオ画像と`assets/princess.webp`の元画像のみです）。
そのため今回はCROWNの実画像化・「かんむりだけを装着する」演出は
**未実装**です。お手数ですが、あらためて画像を添付してください。

加えて、**かんむりだけを抽出できたとしても、もう1つ準備が必要な
制約があります**：現在の`princess.webp`（ベース）、`hair/*.webp`、
`dresses/*.webp`はすべて、同じ金色のかんむり（Gold Crown相当）が
すでに焼き込まれた状態の全身画像です。かんむりだけの透明レイヤーを
その上に重ねると、「元から乗っているかんむり」と「新しく重ねる
かんむり」が二重表示されてしまいます（今回のご指示で明確に禁止
されている状態）。これを避けるには、**かんむりが写っていない
（または綺麗に除去された）ベース/全身画像**も別途必要です。現在の
画像を機械的に加工してかんむりを消すのは、境界が不自然になるリスクが
高く実施していません。次のいずれかをご検討いただけると、CROWNの
本実装に進めます：

1. Gold/Flower/Purpleのかんむり単体（できれば透明背景）の3枚
2. かんむりを付けていない状態の同ポーズ全身画像（あれば）

②が無い場合は、①だけでも「選択肢カードに実写のかんむり画像を表示する」
ところまでは高品質に実装できます（Princess本体への二重表示なしでの
装着までは、②が無いと二重表示を避けられないため保留します）。

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
`position:absolute; inset:0; width:100%;` で base → dress → shoes →
hair → crown の順に重ねるだけで、拡大縮小やscaleX/scaleYの調整は一切
不要になるように作られています（画像を歪ませる非対称スケールは禁止。
実際のDOM構造は上記「見た目のレイヤー合成」を参照）。

## `dressup.js` 側の対応

各アイテムの `DRESSUP_ITEMS` 定義には `assetPath`（全身画像・暫定方式）と
`layerPath`/`layerSlot`（独立透明レイヤー・本来の方式）の両方が用意されて
います。

- **全身画像しか無い場合**：そのアイテムに`hasAsset: true`を追加してください
  （`hair/*`・`dresses/pink|blue|yellow`は既に設定済み）。正解として選ばれると
  `dressup.equipped[catId]`に記録され、`WHOLE_BODY_PRIORITY`の優先順位に
  従って選ばれた1枚が、Princess Preview全体へフェード＋scaleで「変身」します。
  発音練習・Great job・次のカテゴリー・完成画面まで維持され、PLAY AGAINで
  リセットされます（`dressup.activePortraitSrc`で状態管理）。
- **髪だけ／かんむりだけ等を切り抜いた独立透明素材がある場合**：そのアイテムに
  `layerPath`（画像パス）を設定してください（`layerSlot`は省略時catIdと同じ）。
  正解として選ばれると、対応する`dressup-layer-*`（`index.html`の
  `#dressup-portrait-layers`内）に自動的に表示され、`WHOLE_BODY_PRIORITY`を
  経由しない、他カテゴリーと干渉しない独立表示になります。

**現時点ではどのアイテムも`layerPath`を持たず、全て`assetPath`+`hasAsset`の
「全身差し替え」方式のみです。** そのため複数カテゴリーの全身画像アイテムが
同時にequippedされても、実際に見えるのは`WHOLE_BODY_PRIORITY`が選んだ
1枚だけです（詳細は上記「HAIR × DRESSの組み合わせに関する既知の制約」）。
これは意図的な暫定仕様であり、`dressup.equipped`自体には4カテゴリー分の
選択が正しく独立保持されています。

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

正解タップした直後は、そのカードに金枠+✓（`.dressup-option-equipped`）が
一瞬付与され、「今これを着けている」ことを視覚的に示す。次の問題へ切り替わる
までの短い演出だが、将来のFREE DRESS UPモード（好きな組み合わせを自由に
交換できる画面）では同じクラスを常時表示にそのまま使える設計にしてある。
