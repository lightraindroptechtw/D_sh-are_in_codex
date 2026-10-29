# 財務插件私有來源修正與實測

修正位於自有副本；原始語料、官方套件及共通轉換器均未為此插件改寫。這不是已修正上游發布版本，也不覆蓋 group-a 的原版失敗成績。

原版基準：10/32 案例通過；修正版：60/60 通過。

## 已修正項目

- 百分比數值維持百分點，但輸出文字先除以100再使用百分比格式，防止重複乘100。
- 千分位只作用於整數部分，小數四位不再插逗點。
- 投資組合輸入允許動態資產名稱，並在執行時檢查非負有限數值；回傳權重與再平衡訂單，Current欄使用現值。
- 只省略未產生的頂層輸出欄位，使嚴格官方JSON驗證可用；零波動Sharpe用null表示不適用，不輸出NaN。
- 同時要求log及annualized時兩者皆計算，不因log分支提早返回。
- 同業比較與中位數相同時顯示at median/neutral，保留嚴格小於樣本的原百分位定義。

## 可審查產物

- [差異檔](finance-source-repair.patch)
- [完整預期、實際與斷言](finance-repair.json)
- 私有修正來源：`work/v040-functional-a/repaired-sources/finance-data`
- 原版基準：[group-a.json](group-a.json)

## 測試範圍

十個動作均有內容斷言，嚴格模式與寬鬆模式分開生成新包。各模式還包括數字精度、四種百分比、七種比率、三種時間價值、零波動、再平衡與輸入拒絕。沒有任何模型、登入、付費或外部服務呼叫；不將合成數學測試當投資建議或真實行情驗證。

| 模式 | 案例 | 通過 | 失敗 |
|---|---:|---:|---:|
| strict | 30 | 30 | 0 |
| lenient | 30 | 30 | 0 |

## 每個案例

| 模式 | 案例 | 結果 |
|---|---|---|
| strict | format thousands | passed |
| strict | format four decimal places | passed |
| strict | format negative and currency | passed |
| strict | format percentage | passed |
| strict | format Chinese unit | passed |
| strict | return simple | passed |
| strict | return annualized | passed |
| strict | return log | passed |
| strict | return combined | passed |
| strict | ratio PE | passed |
| strict | ratio PB | passed |
| strict | ratio debt to equity | passed |
| strict | ratio ROE | passed |
| strict | ratio ROA | passed |
| strict | ratio gross margin | passed |
| strict | ratio net margin | passed |
| strict | value FV | passed |
| strict | value PV | passed |
| strict | value implied rate | passed |
| strict | risk varying returns | passed |
| strict | risk constant returns | passed |
| strict | checklist | passed |
| strict | plan unchanged principal | passed |
| strict | plan monthly deposits | passed |
| strict | portfolio weights and rebalance | passed |
| strict | trend | passed |
| strict | peer median | passed |
| strict | peer favorable below median | passed |
| strict | reject non-numeric portfolio | passed |
| strict | reject incorrect total target | passed |
| lenient | format thousands | passed |
| lenient | format four decimal places | passed |
| lenient | format negative and currency | passed |
| lenient | format percentage | passed |
| lenient | format Chinese unit | passed |
| lenient | return simple | passed |
| lenient | return annualized | passed |
| lenient | return log | passed |
| lenient | return combined | passed |
| lenient | ratio PE | passed |
| lenient | ratio PB | passed |
| lenient | ratio debt to equity | passed |
| lenient | ratio ROE | passed |
| lenient | ratio ROA | passed |
| lenient | ratio gross margin | passed |
| lenient | ratio net margin | passed |
| lenient | value FV | passed |
| lenient | value PV | passed |
| lenient | value implied rate | passed |
| lenient | risk varying returns | passed |
| lenient | risk constant returns | passed |
| lenient | checklist | passed |
| lenient | plan unchanged principal | passed |
| lenient | plan monthly deposits | passed |
| lenient | portfolio weights and rebalance | passed |
| lenient | trend | passed |
| lenient | peer median | passed |
| lenient | peer favorable below median | passed |
| lenient | reject non-numeric portfolio | passed |
| lenient | reject incorrect total target | passed |

所有原始來源雜湊在測後再核對一致。完整數值輸出、失敗訊息與生成包雜湊見 JSON；原版純函式觀察另列於 baselineHelperObservations，未灌入修正版 MCP 通過數。
