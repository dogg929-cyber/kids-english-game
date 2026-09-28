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
- **DRESS（ドレス）：実画像を導入済み（2回目のリクエストでCrownなし素材に
  差し替え済み）**
  `dresses/pink.webp` / `dresses/blue.webp` / `dresses/yellow.webp`。
  **初回導入時はLong Hair + Gold Crown込みの全身portraitだったが、
  2回目のリクエストで「かんむりなしで作り直した」新素材（Pink/Blue/Yellow
  それぞれ単独ポーズ、髪型はロングだが王冠は焼き込まれていない）に
  完全差し替え済み。** これにより、DRESS表示中もCROWNの独立レイヤーを
  二重王冠なしで重ねられるようになった（詳細は下記「CROWNの実装」・
  「DRESS×CROWNの独立性」）。
  正解タップの瞬間、Princess Previewがこの画像に「変身」する（fade+scale、
  横スライドなし）。以後、発音練習・Great job・次のカテゴリー・完成画面まで
  同じ画像を維持し、PLAY AGAINでベース画像に戻る。
- **CROWN（かんむり）：実装済み。`layerPath`による独立透明レイヤー方式**
  `crowns/gold.webp` / `crowns/flower.webp` / `crowns/purple.webp`
  （いずれも透明背景・かんむり単体のみを切り抜いた画像）。HAIR/DRESSとは
  異なり全身画像ではなく、`assets/dressup/base/base.webp`（かんむり無しの
  Base Princess）の上に、選んだかんむりだけを独立レイヤーとして重ねる
  本来の「着せ替え」方式で実装されている（詳細は下記「CROWNの実装」）。
- **SHOES：まだ仮素材（色スウォッチ＋絵文字カード）のまま**
  実画像が用意でき次第、下記の「`dressup.js` 側の対応」と同じ手順
  （`assetPath`を設定し`hasAsset: true`を追加）で同じ変身演出がそのまま使える。

### ⚠️ HAIR × DRESS の組み合わせに関する既知の制約

HAIRの画像は「Purple Dress + Gold Crown込みの全身portrait」であり、
髪だけを切り抜いた透明レイヤー素材（`layerPath`）ではありません
（HAIR画像は全部Purple Dress固定）。DRESSの画像は2回目のリクエストで
Crownなし素材に差し替え済みですが、それでも「その色のドレスを着た
全身portrait」であり、髪型だけを独立して選べる透明レイヤーではない点は
変わりません。

そのため今の実装は、`layerPath`を持たない「全身画像(`hasAsset:true`)」の
アイテムが複数equippedされている場合、`dressup.js`内の
`WHOLE_BODY_PRIORITY = ["shoes", "dress", "hair"]`という優先順位に
従って1枚だけをPrincess Preview全体に表示します（無理な合成は
しません。CROWNは`layerPath`を持つ独立レイヤーとして別扱いのため、
このリストには含まれません——詳細は下記「CROWNの実装」）。現状 dress が
hair より優先されるため、ゲームの出題順HAIR→CROWN→DRESS→SHOESでは
実際の見え方は：

1. HAIRを選ぶ → Previewがその髪型のportrait（Purple Dress+Gold Crown込み）
   に変身
2. CROWNを選ぶ → Base Princess（かんむり無し）＋選んだかんむりの独立
   レイヤーに切り替わる（実装済み。詳細は下記）
3. **DRESSを選ぶ → Previewがそのドレス色のportrait（Crownなし）に
   変身し、直前まで表示されていた選択した髪型は見た目上消える。
   ただしCROWNは2回目のリクエストでDRESS素材がCrownなしになったため、
   引き続き独立レイヤーとして正しく重なり続ける（下記「DRESS×CROWNの
   独立性」参照）**
4. SHOESは仮素材なので見た目は変わらない（Dress+Crownのまま）
5. 完成画面も最後に変身したDress画像＋Crownのまま

**選んだHairのアイテム自体は`dressup.equipped.hair`にきちんと保持され
続けており**（Look Badgeの「HAIR達成」表示や選択肢カードの金枠+✓、
スコアには一切影響しません）、失われるのは「同時に見た目へ反映する
こと」だけです。

これを解消するには、HAIR/SHOESそれぞれを**同一のbase portrait・同一
座標**の上に重ねられる、**髪だけを切り抜いた透明レイヤー素材**（上記
「見た目のレイヤー合成」・下記「想定する構造」）が必要です（DRESSは
今回の差し替えで実質的にCrownとの独立を達成済みだが、HAIRとの独立は
まだ未解決）。現在の画像からそのような高品質な透明レイヤーを機械的に
生成するのは、顔・耳・首まわりの境界が不自然になるリスクが高く実施して
いません（無理に合成して品質を落とすよりも、現状の
「全身差し替え・優先順位」方式を暫定仕様として採用しています）。
アイテムに`layerPath`/`layerSlot`を設定するだけで、そのカテゴリーは
`WHOLE_BODY_PRIORITY`を経由せず独立レイヤーとして表示されるようになる
ため、これはコード変更なしで解消できます。

### ✅ CROWNの実装（`layerPath` + `crownStyle`による独立透明レイヤー）

`base/base.webp`（かんむり無しのBase Princess、ユーザー提供画像を背景
除去して作成）を土台に、`crowns/gold.webp` / `flower.webp` / `purple.webp`
（ユーザー提供の3かんむり並び画像を透明背景のまま個別に切り出したもの）を
`#dressup-layer-crown`（メインプレビュー）・`#dressup-speak-crown`
（発音練習オーバーレイ）・`#dressup-round-crown`（完成オーバーレイ）の
3箇所すべてに同期して重ねる。各かんむりは形・サイズが異なるため、
アイテムごとに個別の`crownStyle: {top, left, width}`（Base Princess
1024×1536キャンバスに対する%指定）を持ち、共通のCSS数値は共有しない。
拡大縮小は`width`のみ（`height:auto`）で行い、非対称スケール
（scaleX/scaleY個別調整）は一切使用していない。タップ〜装着までは
スパークル→0.3秒の「ポンッ」ポップイン演出（`dressup-crown-pop`、
opacity+均一scaleのみ、prefers-reduced-motionで無効化）。

**位置調整はPlaywrightスクリーンショットで実測・目視確認済み**
（`crownStyle`の値はBase Princessの頭部の実際のalphaチャンネル解析と
スクリーンショット目視の両方で検証し、初回の推定値のまま調整不要だった）。
`crownStyle`は今表示中のBaseレイヤー画像の種類（`bodyKey`:
`"base"`/`"pink"`/`"blue"`/`"yellow"`）ごとに個別の値を持てる構造になって
いる（下記「DRESS×CROWNの独立性」で理由を説明）。現状は4種類とも
実質同じ頭の位置・ポーズだったため同値のままで問題なかったが、将来
異なるポーズのDress素材を追加する場合はbodyKeyごとに調整できる。

### ✅ DRESS×CROWNの独立性（2回目のリクエストで実装。二重王冠の防止はデータ駆動に）

初回実装時はDRESS画像（Pink/Blue/Yellow）にもGold Crown相当が焼き込まれて
いたため、二重王冠を避けるためDRESS表示中はCrownレイヤーを常に非表示に
していた。**2回目のリクエストで、ユーザーから「王冠なしで作り直した」新しい
Pink/Blue/Yellow Dress素材が提供され、`dresses/*.webp`をこの新素材に
完全差し替えした。** これにより、DRESSとCROWNは完全に独立して同時成立する
ようになった：

- Pink Dress + Gold Crown / Flower Crown / Purple Crown
- Blue Dress + Gold Crown / Flower Crown / Purple Crown
- Yellow Dress + Gold Crown / Flower Crown / Purple Crown

の9通りすべてが二重王冠なしで成立する（Playwrightで確認済み。
`combo-blue-flower.png` / `combo-pink-purple.png` / `combo-yellow-gold.png`）。
**Dressを変更してもCrownは消えず、Crownを変更してもDressは変わらない**
（`equipped.dress`と`equipped.crown`は完全に独立したまま、それぞれの
見た目も両方同時にレンダリングされる）。

二重王冠の防止ロジックは、DRESS/SHOES固有のハードコードではなく、
各アイテムの**`crownBaked`フラグ**によるデータ駆動判定に統一されている
（`computeDressupVisual()`参照）：

- `crownBaked: true` のアイテム（現在はHAIRの3枚のみ）が表示中の場合、
  Crownレイヤーは必ず非表示になる（二重王冠防止）。
- `crownBaked`が付いていないアイテム（現在は新しくなったDRESSの
  Pink/Blue/Yellow）が表示中の場合、Crownレイヤーは`equipped.crown`が
  あればそのまま独立レイヤーとして重なる。

そのため、将来SHOESに実画像を追加する場合も、その画像が王冠を含まない
素材であれば`crownBaked`を付けないだけでCrownとの同時表示に対応できる
（コード変更不要）。

### ⚠️ HAIR × CROWNの組み合わせに関する既知の制約（HAIRのみ残存）

HAIRの画像（`hair/*.webp`）は元から金色のかんむり（Gold Crown相当）が
焼き込まれた全身画像のままなので（`crownBaked: true`）、HAIRの全身画像が
表示されている間（＝まだDRESSを選んでいない状態）は、二重王冠を避ける
ためCrownレイヤーが非表示になる：

1. HAIRを選ぶ → Previewがその髪型のportrait（かんむり焼き込み済み）に変身
2. CROWN（例：Flower Crown）を選ぶ → HAIRのportraitが一旦Base Princess
   ＋Flowerかんむりレイヤーに切り替わり、正しく表示される（二重表示なし）
3. **DRESS（例：Blue Dress）を選ぶ → Previewがそのドレス色のportrait
   （Crownなし新素材）に変身し、直前まで表示されていたFlowerかんむりは
   そのまま独立レイヤーとして表示され続ける**（二重王冠にならない。
   `combo-blue-flower.png`で確認済み）
4. SHOESも同様（実画像追加時、crownBakedを付けなければCrown維持）
5. 完成画面も最後に変身したDress画像＋Crownのまま

**`dressup.equipped.crown`自体はHAIR表示中も保持され続けており**
（Look Badgeの「CROWN達成」表示・選択肢カードの金枠+✓・スコアには一切
影響しない）、失われるのは「HAIR表示中に同時に見た目へ反映すること」
だけ——HAIR×DRESSと全く同じ種類の制約である。

これを解消するには、HAIRに**かんむりを含まない**全身画像（または
「髪だけ」を切り抜いた独立透明レイヤー）が別途必要になる。現在の画像を
機械的に加工してかんむりだけ消すのは、境界が不自然になるリスクが高く
実施していない。

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
  リセットされます（`dressup.activePortraitSrc`で状態管理）。この全身画像に
  元から王冠が焼き込まれている場合は`crownBaked: true`も追加してください
  （現在はHAIRの3項目のみ）。付けると、その画像が表示されている間は
  二重王冠防止のためCrownレイヤーが自動的に非表示になります。付けなければ
  （現在のDRESSの3項目）、equipped.crownがあれば自動的にCrownレイヤーと
  独立して同時表示されます。
- **髪だけ／かんむりだけ等を切り抜いた独立透明素材がある場合**：そのアイテムに
  `layerPath`（画像パス）を設定してください（`layerSlot`は省略時catIdと同じ）。
  正解として選ばれると、対応する`dressup-layer-*`（`index.html`の
  `#dressup-portrait-layers`内）に自動的に表示され、`WHOLE_BODY_PRIORITY`を
  経由しない、他カテゴリーと干渉しない独立表示になります。**CROWNの3項目
  （gold/flower/purple）は実際にこの方式で実装済みです**（`crownStyle`に
  よる個別位置調整、専用の`applyCrownLayer()`／3箇所同期については上記
  「CROWNの実装」を参照）。CROWNが他の全身画像アイテムと同時表示できるか
  どうかは、その全身画像側の`crownBaked`フラグで判定されます（上記
  「DRESS×CROWNの独立性」参照。`WHOLE_BODY_PRIORITY`配列自体にCROWNは
  含まれません）。

**HAIR/DRESS/SHOESは現時点でどのアイテムも`layerPath`を持たず、全て
`assetPath`+`hasAsset`の「全身差し替え」方式のみです。** そのため複数
カテゴリーの全身画像アイテムが同時にequippedされても、実際に見えるのは
`WHOLE_BODY_PRIORITY`が選んだ1枚だけです（詳細は上記「HAIR × DRESSの
組み合わせに関する既知の制約」）。これは意図的な暫定仕様であり、
`dressup.equipped`自体には4カテゴリー分の
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
